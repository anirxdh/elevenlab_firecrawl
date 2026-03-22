/**
 * Comprehensive unit tests for src/background/api/backend-client.ts
 *
 * Covers:
 *   - sendTask() request formatting and error handling
 *   - sendTaskContinue() request formatting
 *   - transcribeAudio() with FormData
 *   - transcribeAudioStreaming() WebSocket flow
 *   - TaskResponse interface with reasoning field
 *   - checkBackendHealth() success and failure
 *   - connectSSE() EventSource creation
 */

// ─── Mock globals ────────────────────────────────────────────────────────────

const mockFetch = jest.fn();
Object.defineProperty(global, 'fetch', { value: mockFetch, writable: true });

// Mock atob for base64 decoding (used by transcribeAudio)
Object.defineProperty(global, 'atob', {
  value: (str: string): string => Buffer.from(str, 'base64').toString('binary'),
  writable: true,
});

// Mock Blob
class MockBlob {
  parts: any[];
  options: any;
  size: number;
  type: string;
  constructor(parts: any[], options?: any) {
    this.parts = parts;
    this.options = options;
    this.size = parts.reduce((acc: number, p: any) => acc + (p.length || p.byteLength || 0), 0);
    this.type = options?.type || '';
  }
}
Object.defineProperty(global, 'Blob', { value: MockBlob, writable: true });

// Mock FormData
class MockFormData {
  private data = new Map<string, any>();
  append(key: string, value: any, filename?: string) {
    this.data.set(key, { value, filename });
  }
  get(key: string) {
    return this.data.get(key)?.value;
  }
  has(key: string) {
    return this.data.has(key);
  }
  getFilename(key: string) {
    return this.data.get(key)?.filename;
  }
}
Object.defineProperty(global, 'FormData', { value: MockFormData, writable: true });

// Mock EventSource
class MockEventSource {
  url: string;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener() {}
  close() {}
}
Object.defineProperty(global, 'EventSource', { value: MockEventSource, writable: true });

// Mock WebSocket
let mockWSInstance: any = null;
class MockWebSocket {
  url: string;
  binaryType: string = 'blob';
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  sentMessages: any[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    mockWSInstance = this;
  }

  send(data: any) {
    this.sentMessages.push(data);
  }

  close() {
    this.closed = true;
  }
}
Object.defineProperty(global, 'WebSocket', { value: MockWebSocket, writable: true });

// ─── Import after mocks ──────────────────────────────────────────────────────

import {
  transcribeAudio,
  transcribeAudioStreaming,
  sendTask,
  sendTaskContinue,
  checkBackendHealth,
  connectSSE,
  TaskResponse,
  ActionHistoryEntry,
} from '../background/api/backend-client';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockFetchResponse(status: number, body: any, ok?: boolean): void {
  mockFetch.mockResolvedValueOnce({
    status,
    ok: ok ?? (status >= 200 && status < 300),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Map([['content-type', 'application/json']]),
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Backend Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWSInstance = null;
    // Suppress console.log/error in tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── transcribeAudio ────────────────────────────────────────────────────

  describe('transcribeAudio()', () => {
    it('sends FormData to /transcribe endpoint', async () => {
      mockFetchResponse(200, { transcript: 'Hello world' });

      const audioBase64 = Buffer.from('test audio data').toString('base64');
      await transcribeAudio(audioBase64, 'audio/webm');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8000/transcribe');
      expect(options.method).toBe('POST');
      // body should be a FormData instance
      expect(options.body).toBeInstanceOf(MockFormData);
    });

    it('returns the transcript text on success', async () => {
      mockFetchResponse(200, { transcript: 'This is a test transcript' });

      const audioBase64 = Buffer.from('audio').toString('base64');
      const result = await transcribeAudio(audioBase64, 'audio/webm');

      expect(result).toBe('This is a test transcript');
    });

    it('includes audio blob and mime_type in FormData', async () => {
      mockFetchResponse(200, { transcript: 'test' });

      const audioBase64 = Buffer.from('audio data').toString('base64');
      await transcribeAudio(audioBase64, 'audio/webm');

      const formData = mockFetch.mock.calls[0][1].body as MockFormData;
      expect(formData.has('audio')).toBe(true);
      expect(formData.has('mime_type')).toBe(true);
      expect(formData.get('mime_type')).toBe('audio/webm');
    });

    it('sets correct filename extension for webm', async () => {
      mockFetchResponse(200, { transcript: 'test' });
      const audioBase64 = Buffer.from('audio').toString('base64');
      await transcribeAudio(audioBase64, 'audio/webm');

      const formData = mockFetch.mock.calls[0][1].body as MockFormData;
      expect(formData.getFilename('audio')).toBe('recording.webm');
    });

    it('sets correct filename extension for ogg', async () => {
      mockFetchResponse(200, { transcript: 'test' });
      const audioBase64 = Buffer.from('audio').toString('base64');
      await transcribeAudio(audioBase64, 'audio/ogg');

      const formData = mockFetch.mock.calls[0][1].body as MockFormData;
      expect(formData.getFilename('audio')).toBe('recording.ogg');
    });

    it('sets correct filename extension for mp4', async () => {
      mockFetchResponse(200, { transcript: 'test' });
      const audioBase64 = Buffer.from('audio').toString('base64');
      await transcribeAudio(audioBase64, 'audio/mp4');

      const formData = mockFetch.mock.calls[0][1].body as MockFormData;
      expect(formData.getFilename('audio')).toBe('recording.mp4');
    });

    it('defaults to webm extension for unknown mime types', async () => {
      mockFetchResponse(200, { transcript: 'test' });
      const audioBase64 = Buffer.from('audio').toString('base64');
      await transcribeAudio(audioBase64, 'audio/wav');

      const formData = mockFetch.mock.calls[0][1].body as MockFormData;
      expect(formData.getFilename('audio')).toBe('recording.webm');
    });

    it('throws on non-200 response', async () => {
      mockFetchResponse(500, { detail: 'Server error' }, false);

      const audioBase64 = Buffer.from('audio').toString('base64');
      await expect(transcribeAudio(audioBase64, 'audio/webm')).rejects.toThrow();
    });

    it('throws credential-specific error on 500 with credential detail', async () => {
      mockFetchResponse(500, { detail: 'Backend AWS credentials not configured' }, false);

      const audioBase64 = Buffer.from('audio').toString('base64');
      await expect(transcribeAudio(audioBase64, 'audio/webm')).rejects.toThrow(
        /credentials/i
      );
    });

    it('throws generic error on 422 validation error', async () => {
      mockFetchResponse(422, { detail: 'Validation failed' }, false);

      const audioBase64 = Buffer.from('audio').toString('base64');
      await expect(transcribeAudio(audioBase64, 'audio/webm')).rejects.toThrow(
        /Transcription failed/
      );
    });

    it('handles non-JSON error response body', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 503,
        ok: false,
        json: () => Promise.reject(new Error('Not JSON')),
        text: () => Promise.resolve('Service Unavailable'),
      });

      const audioBase64 = Buffer.from('audio').toString('base64');
      await expect(transcribeAudio(audioBase64, 'audio/webm')).rejects.toThrow();
    });
  });

  // ── transcribeAudioStreaming ────────────────────────────────────────────

  describe('transcribeAudioStreaming()', () => {
    it('connects WebSocket to /transcribe/stream', async () => {
      const audioBase64 = Buffer.from('audio').toString('base64');

      const promise = transcribeAudioStreaming(audioBase64, 'audio/webm');

      // Wait a tick for the WebSocket constructor to be called
      await new Promise(r => setTimeout(r, 0));

      expect(mockWSInstance).not.toBeNull();
      expect(mockWSInstance.url).toBe('ws://localhost:8000/transcribe/stream');

      // Simulate open
      mockWSInstance.onopen?.({});

      // Should have sent 3 messages: config, audio binary, done signal
      expect(mockWSInstance.sentMessages.length).toBe(3);
      const configMsg = JSON.parse(mockWSInstance.sentMessages[0]);
      expect(configMsg.mime_type).toBe('audio/webm');
      const doneMsg = JSON.parse(mockWSInstance.sentMessages[2]);
      expect(doneMsg.action).toBe('done');

      // Simulate transcript response
      mockWSInstance.onmessage?.({ data: JSON.stringify({ transcript: 'Hello from WS' }) });

      const result = await promise;
      expect(result).toBe('Hello from WS');
      expect(mockWSInstance.closed).toBe(true);
    });

    it('rejects on WebSocket error', async () => {
      const audioBase64 = Buffer.from('audio').toString('base64');

      const promise = transcribeAudioStreaming(audioBase64, 'audio/webm');

      await new Promise(r => setTimeout(r, 0));

      // Simulate error
      mockWSInstance.onerror?.({});

      await expect(promise).rejects.toThrow(/WebSocket connection error/);
    });

    it('rejects when server returns error message', async () => {
      const audioBase64 = Buffer.from('audio').toString('base64');

      const promise = transcribeAudioStreaming(audioBase64, 'audio/webm');

      await new Promise(r => setTimeout(r, 0));

      mockWSInstance.onopen?.({});
      mockWSInstance.onmessage?.({
        data: JSON.stringify({ error: 'Model unavailable' }),
      });

      await expect(promise).rejects.toThrow(/Model unavailable/);
    });

    it('rejects when WebSocket closes before transcript', async () => {
      const audioBase64 = Buffer.from('audio').toString('base64');

      const promise = transcribeAudioStreaming(audioBase64, 'audio/webm');

      await new Promise(r => setTimeout(r, 0));

      mockWSInstance.onopen?.({});
      mockWSInstance.onclose?.({});

      await expect(promise).rejects.toThrow(/WebSocket closed before transcript/);
    });

    it('rejects on timeout (15 seconds)', async () => {
      jest.useFakeTimers();

      const audioBase64 = Buffer.from('audio').toString('base64');

      const promise = transcribeAudioStreaming(audioBase64, 'audio/webm');

      // Advance past 15s timeout
      jest.advanceTimersByTime(16000);

      await expect(promise).rejects.toThrow(/timed out/);

      jest.useRealTimers();
    });

    it('sets binaryType to arraybuffer', async () => {
      const audioBase64 = Buffer.from('audio').toString('base64');

      const promise = transcribeAudioStreaming(audioBase64, 'audio/webm');

      await new Promise(r => setTimeout(r, 0));

      expect(mockWSInstance.binaryType).toBe('arraybuffer');

      // Clean up: trigger error to resolve promise
      mockWSInstance.onerror?.({});
      await promise.catch(() => {});
    });

    it('ignores non-JSON messages', async () => {
      const audioBase64 = Buffer.from('audio').toString('base64');

      const promise = transcribeAudioStreaming(audioBase64, 'audio/webm');

      await new Promise(r => setTimeout(r, 0));

      mockWSInstance.onopen?.({});

      // Send non-JSON message — should not reject
      mockWSInstance.onmessage?.({ data: 'not json at all' });

      // Then send actual transcript
      mockWSInstance.onmessage?.({ data: JSON.stringify({ transcript: 'Real result' }) });

      const result = await promise;
      expect(result).toBe('Real result');
    });
  });

  // ── sendTask ───────────────────────────────────────────────────────────

  describe('sendTask()', () => {
    const sampleDom = { url: 'https://example.com', title: 'Test' };
    const sampleScreenshot = 'data:image/png;base64,iVBORw0KGgoAAAANS';

    it('sends correct JSON to /task', async () => {
      mockFetchResponse(200, { type: 'answer', text: 'The price is $10' });

      await sendTask('what is the price?', sampleScreenshot, sampleDom);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8000/task');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body);
      expect(body.command).toBe('what is the price?');
      expect(body.dom_snapshot).toEqual(sampleDom);
      // The data:image/png;base64, prefix should be stripped
      expect(body.screenshot).not.toContain('data:image');
      expect(body.screenshot).toBe('iVBORw0KGgoAAAANS');
    });

    it('strips data:image/jpeg;base64, prefix as well', async () => {
      const jpegScreenshot = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
      mockFetchResponse(200, { type: 'answer', text: 'OK' });

      await sendTask('test', jpegScreenshot, sampleDom);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.screenshot).toBe('/9j/4AAQSkZJRg==');
    });

    it('returns the task response on success', async () => {
      const taskResult = {
        type: 'steps',
        actions: [{ action: 'click', selector: '#btn', description: 'Click' }],
      };
      mockFetchResponse(200, taskResult);

      const result = await sendTask('click the button', sampleScreenshot, sampleDom);

      expect(result.type).toBe('steps');
      expect(result.actions).toHaveLength(1);
    });

    it('returns task response with reasoning field', async () => {
      const taskResult: TaskResponse = {
        type: 'answer',
        text: 'The price is $10',
        reasoning: 'I found the price element in the DOM and extracted its text content.',
      };
      mockFetchResponse(200, taskResult);

      const result = await sendTask('what is the price?', sampleScreenshot, sampleDom);

      expect(result.type).toBe('answer');
      expect(result.text).toBe('The price is $10');
      expect(result.reasoning).toBe('I found the price element in the DOM and extracted its text content.');
    });

    it('returns done response with summary', async () => {
      const taskResult: TaskResponse = {
        type: 'done',
        summary: 'Successfully completed all steps.',
      };
      mockFetchResponse(200, taskResult);

      const result = await sendTask('do the thing', sampleScreenshot, sampleDom);

      expect(result.type).toBe('done');
      expect(result.summary).toBe('Successfully completed all steps.');
    });

    it('throws on non-200 response', async () => {
      mockFetchResponse(422, { detail: 'Validation error' }, false);

      await expect(
        sendTask('test', sampleScreenshot, sampleDom)
      ).rejects.toThrow();
    });

    it('throws credential-specific error on 500 with credential detail', async () => {
      mockFetchResponse(500, { detail: 'Backend AWS credentials not configured' }, false);

      await expect(
        sendTask('test', sampleScreenshot, sampleDom)
      ).rejects.toThrow(/credentials/i);
    });

    it('throws generic error on 400 bad request', async () => {
      mockFetchResponse(400, { detail: 'Invalid command format' }, false);

      await expect(
        sendTask('', sampleScreenshot, sampleDom)
      ).rejects.toThrow(/Task processing failed/);
    });

    it('handles non-JSON error response', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 502,
        ok: false,
        json: () => Promise.reject(new Error('Not JSON')),
        text: () => Promise.resolve('Bad Gateway'),
      });

      await expect(
        sendTask('test', sampleScreenshot, sampleDom)
      ).rejects.toThrow();
    });
  });

  // ── sendTaskContinue ───────────────────────────────────────────────────

  describe('sendTaskContinue()', () => {
    const sampleScreenshot = 'data:image/png;base64,abc123';
    const sampleDom = { url: 'https://example.com/page2', title: 'Page 2' };
    const sampleHistory: ActionHistoryEntry[] = [
      { description: 'Clicked the search button', result: "Clicked 'Search'" },
      { description: 'Typed query into search', result: "Typed 'headphones' into #search" },
    ];

    it('sends correct JSON to /task/continue', async () => {
      mockFetchResponse(200, { type: 'done' });

      await sendTaskContinue('find headphones', sampleHistory, sampleScreenshot, sampleDom);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8000/task/continue');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body);
      expect(body.original_command).toBe('find headphones');
      expect(body.action_history).toEqual(sampleHistory);
      expect(body.dom_snapshot).toEqual(sampleDom);
      // Screenshot prefix should be stripped
      expect(body.screenshot).toBe('abc123');
    });

    it('returns steps response for continued actions', async () => {
      const continueResult: TaskResponse = {
        type: 'steps',
        actions: [
          { action: 'click', selector: '.product-link', description: 'Click first result' },
        ],
        reasoning: 'The search results are now visible, clicking the first one.',
      };
      mockFetchResponse(200, continueResult);

      const result = await sendTaskContinue('find headphones', sampleHistory, sampleScreenshot, sampleDom);

      expect(result.type).toBe('steps');
      expect(result.actions).toHaveLength(1);
      expect(result.reasoning).toContain('search results');
    });

    it('returns done response when task is complete', async () => {
      mockFetchResponse(200, { type: 'done', summary: 'Task completed successfully' });

      const result = await sendTaskContinue('find headphones', sampleHistory, sampleScreenshot, sampleDom);

      expect(result.type).toBe('done');
    });

    it('throws on non-200 response', async () => {
      mockFetchResponse(500, { detail: 'Internal error' }, false);

      await expect(
        sendTaskContinue('test', sampleHistory, sampleScreenshot, sampleDom)
      ).rejects.toThrow();
    });

    it('throws credential-specific error on 500 with credential detail', async () => {
      mockFetchResponse(500, { detail: 'Backend AWS credentials not configured' }, false);

      await expect(
        sendTaskContinue('test', sampleHistory, sampleScreenshot, sampleDom)
      ).rejects.toThrow(/credentials/i);
    });

    it('sends empty action history for first continue', async () => {
      mockFetchResponse(200, { type: 'done' });

      await sendTaskContinue('test', [], sampleScreenshot, sampleDom);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.action_history).toEqual([]);
    });
  });

  // ── checkBackendHealth ─────────────────────────────────────────────────

  describe('checkBackendHealth()', () => {
    it('returns true when backend responds with 200', async () => {
      mockFetchResponse(200, { status: 'ok' });

      const result = await checkBackendHealth();
      expect(result).toBe(true);

      // Verify it calls the correct URL
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:8000/health', { method: 'GET' });
    });

    it('returns false when backend responds with non-200', async () => {
      mockFetchResponse(500, {}, false);

      const result = await checkBackendHealth();
      expect(result).toBe(false);
    });

    it('returns false when fetch throws (network error)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await checkBackendHealth();
      expect(result).toBe(false);
    });

    it('returns false on DNS resolution failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND localhost'));

      const result = await checkBackendHealth();
      expect(result).toBe(false);
    });

    it('returns false on connection refused', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await checkBackendHealth();
      expect(result).toBe(false);
    });

    it('returns false on timeout', async () => {
      mockFetch.mockRejectedValueOnce(new Error('AbortError: signal timed out'));

      const result = await checkBackendHealth();
      expect(result).toBe(false);
    });
  });

  // ── connectSSE ─────────────────────────────────────────────────────────

  describe('connectSSE()', () => {
    it('returns an EventSource pointed at /events', () => {
      const es = connectSSE();
      expect(es).toBeInstanceOf(MockEventSource);
      expect((es as any).url).toBe('http://localhost:8000/events');
    });

    it('returns a new EventSource on each call', () => {
      const es1 = connectSSE();
      const es2 = connectSSE();
      expect(es1).not.toBe(es2);
    });
  });

  // ── TaskResponse interface ─────────────────────────────────────────────

  describe('TaskResponse interface', () => {
    it('handles answer type with all fields', async () => {
      const response: TaskResponse = {
        type: 'answer',
        text: 'The item costs $29.99',
        reasoning: 'Found price in DOM element .price-tag',
      };
      mockFetchResponse(200, response);

      const result = await sendTask('price?', 'data:image/png;base64,x', {});

      expect(result.type).toBe('answer');
      expect(result.text).toBeDefined();
      expect(result.reasoning).toBeDefined();
    });

    it('handles steps type with action details', async () => {
      const response: TaskResponse = {
        type: 'steps',
        actions: [
          { action: 'click', selector: '#btn', description: 'Click button' },
          { action: 'type', selector: '#input', value: 'test', description: 'Type text' },
          { action: 'navigate', url: 'https://x.com', description: 'Go to page' },
          { action: 'scroll', direction: 'down', description: 'Scroll down' },
          { action: 'extract', selector: '.result', description: 'Get text' },
        ],
        reasoning: 'Multi-step plan generated',
      };
      mockFetchResponse(200, response);

      const result = await sendTask('do stuff', 'data:image/png;base64,x', {});

      expect(result.type).toBe('steps');
      expect(result.actions).toHaveLength(5);
      expect(result.actions![0].action).toBe('click');
      expect(result.actions![1].value).toBe('test');
      expect(result.actions![2].url).toBe('https://x.com');
      expect(result.actions![3].direction).toBe('down');
    });

    it('handles done type with summary', async () => {
      const response: TaskResponse = {
        type: 'done',
        summary: 'All actions completed successfully',
      };
      mockFetchResponse(200, response);

      const result = await sendTask('finish', 'data:image/png;base64,x', {});

      expect(result.type).toBe('done');
      expect(result.summary).toBe('All actions completed successfully');
    });

    it('handles actions with speak field for TTS', async () => {
      const response: TaskResponse = {
        type: 'steps',
        actions: [
          { action: 'click', selector: '#cart', description: 'Add to cart', speak: 'Adding to cart' },
          { action: 'navigate', url: 'https://amazon.com', description: 'Go to Amazon', speak: 'Opening Amazon' },
        ],
        reasoning: 'Multi-step plan with TTS hints',
      };
      mockFetchResponse(200, response);

      const result = await sendTask('buy something', 'data:image/png;base64,x', {});

      expect(result.type).toBe('steps');
      expect(result.actions).toHaveLength(2);
      expect(result.actions![0].speak).toBe('Adding to cart');
      expect(result.actions![1].speak).toBe('Opening Amazon');
    });
  });
});
