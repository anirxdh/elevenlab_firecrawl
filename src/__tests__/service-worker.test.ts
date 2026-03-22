/**
 * Unit tests for src/background/service-worker.ts
 *
 * Tests the message handler, cancellation, conversation management,
 * lifecycle events, and agent loop behavior.
 *
 * The service-worker module has many side effects on import
 * (chrome.runtime.onMessage listeners, SSE init, etc.), so we set
 * up all mocks before requiring the module.
 */

// ─── Chrome API mocks (must be set up before any imports) ─────────────────────

const mockTabsSendMessage = jest.fn().mockResolvedValue(undefined);
const mockTabsQuery = jest.fn();
const mockTabsCreate = jest.fn();
const mockSetBadgeText = jest.fn();
const mockSetBadgeBackgroundColor = jest.fn();
const mockRuntimeSendMessage = jest.fn().mockResolvedValue(undefined);
const mockGetURL = jest.fn().mockReturnValue('chrome-extension://fake-id/welcome.html');
const mockStorageGet = jest.fn().mockResolvedValue({});
const mockStorageSet = jest.fn().mockResolvedValue(undefined);

// Listener capture arrays — we'll grab the registered handlers from these
const onMessageListeners: Function[] = [];
const onInstalledListeners: Function[] = [];
const storageChangedListeners: Function[] = [];
const tabsRemovedListeners: Function[] = [];

const chromeMock: any = {
  runtime: {
    onMessage: {
      addListener: jest.fn((fn: Function) => { onMessageListeners.push(fn); }),
    },
    onInstalled: {
      addListener: jest.fn((fn: Function) => { onInstalledListeners.push(fn); }),
    },
    sendMessage: mockRuntimeSendMessage,
    getURL: mockGetURL,
    getContexts: jest.fn().mockResolvedValue([]),
  },
  tabs: {
    sendMessage: mockTabsSendMessage,
    query: mockTabsQuery,
    create: mockTabsCreate,
    onRemoved: {
      addListener: jest.fn((fn: Function) => { tabsRemovedListeners.push(fn); }),
    },
  },
  action: {
    setBadgeText: mockSetBadgeText,
    setBadgeBackgroundColor: mockSetBadgeBackgroundColor,
  },
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
    },
    onChanged: {
      addListener: jest.fn((fn: Function) => { storageChangedListeners.push(fn); }),
    },
  },
  offscreen: {
    createDocument: jest.fn().mockResolvedValue(undefined),
  },
};

// Set chrome globally BEFORE any module imports
(global as any).chrome = chromeMock;

// Mock EventSource for SSE
class MockEventSource {
  url: string;
  onerror: ((ev: any) => void) | null = null;
  constructor(url: string) { this.url = url; }
  addEventListener() {}
  close() {}
}
(global as any).EventSource = MockEventSource;

// ─── Module mocks (must be before import) ─────────────────────────────────────

jest.mock('../shared/storage', () => ({
  isMicPermissionGranted: jest.fn().mockResolvedValue(true),
}));

jest.mock('../shared/constants', () => ({
  MAX_CONVERSATION_TURNS: 20,
}));

jest.mock('../background/screenshot', () => ({
  captureScreenshot: jest.fn().mockResolvedValue('data:image/png;base64,SCREENSHOT_DATA'),
}));

jest.mock('../background/api/backend-client', () => ({
  transcribeAudio: jest.fn().mockResolvedValue('hello world'),
  transcribeAudioStreaming: jest.fn().mockResolvedValue('hello world'),
  connectSSE: jest.fn().mockReturnValue(new MockEventSource('http://localhost:8000/events')),
  checkBackendHealth: jest.fn().mockResolvedValue(false), // backend not reachable by default
  sendTask: jest.fn().mockResolvedValue({ type: 'answer', text: 'Test answer' }),
  sendTaskContinue: jest.fn().mockResolvedValue({ type: 'done' }),
  scrapeUrl: jest.fn().mockRejectedValue(new Error('Firecrawl not available')),
}));

jest.mock('../background/api/groq-vision', () => ({
  streamVisionResponse: jest.fn(),
  generateTtsSummary: jest.fn(),
}));

// ─── Import the module (triggers side effects) ──────────────────────────────

import { captureScreenshot } from '../background/screenshot';
import { sendTask, sendTaskContinue, checkBackendHealth } from '../background/api/backend-client';

// Require the service worker module to trigger side-effect registrations.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../background/service-worker');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMessageHandler(): Function {
  expect(onMessageListeners.length).toBeGreaterThan(0);
  return onMessageListeners[0];
}

/**
 * Simulate sending a message to the service worker's onMessage handler.
 */
function sendMessageToSW(
  message: any,
  sender: Partial<chrome.runtime.MessageSender> = {}
): Promise<any> {
  const handler = getMessageHandler();
  return new Promise((resolve) => {
    const sendResponse = (response?: any) => resolve(response);
    handler(message, sender, sendResponse);
  });
}

/**
 * Helper to set up standard mockTabsSendMessage for agent loop tests.
 * Returns a mock implementation that handles scrape-dom, execute-action,
 * and wait-for-dom-stable messages.
 *
 * IMPORTANT: scrape-dom must return buttons/inputs/links > 0 to satisfy
 * waitForDomContent() and avoid 8-second timeout loops.
 */
function setupAgentLoopMocks(executeResult = { ok: true, summary: "Clicked 'Button'" }) {
  const meaningfulSnapshot = {
    url: 'https://example.com',
    buttons: [{ selector: '#btn', text: 'OK' }],
    inputs: [{ selector: '#input', type: 'text' }],
    links: [],
  };
  mockTabsSendMessage.mockImplementation((_tabId: number, msg: any) => {
    if (msg.action === 'execute-action') {
      return Promise.resolve(executeResult);
    }
    if (msg.action === 'scrape-dom') {
      return Promise.resolve({ ok: true, snapshot: meaningfulSnapshot });
    }
    if (msg.action === 'wait-for-dom-stable') {
      return Promise.resolve({ stable: true });
    }
    return Promise.resolve(undefined);
  });
}

/**
 * Run a follow-up and wait for the async pipeline to complete.
 * Ensures pipelineRunning resets before next test.
 */
async function runFollowUpAndWait(tabId: number, text: string, waitMs = 1500): Promise<void> {
  await sendMessageToSW(
    { action: 'follow-up', text },
    { tab: { id: tabId } as chrome.tabs.Tab }
  );
  await new Promise(r => setTimeout(r, waitMs));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Service Worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-set common mock return values (clearAllMocks resets them)
    mockTabsSendMessage.mockResolvedValue(undefined);
    (sendTask as jest.Mock).mockResolvedValue({ type: 'answer', text: 'Test answer' });
    (sendTaskContinue as jest.Mock).mockResolvedValue({ type: 'done' });
    (captureScreenshot as jest.Mock).mockResolvedValue('data:image/png;base64,SCREENSHOT');
    (checkBackendHealth as jest.Mock).mockResolvedValue(false);
    mockRuntimeSendMessage.mockResolvedValue(undefined);

    // Suppress console output
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Listener registration ──────────────────────────────────────────────

  describe('listener registration', () => {
    it('registers an onMessage listener', () => {
      expect(onMessageListeners.length).toBeGreaterThan(0);
      expect(typeof onMessageListeners[0]).toBe('function');
    });

    it('registers an onInstalled listener', () => {
      expect(onInstalledListeners.length).toBeGreaterThan(0);
    });

    it('registers a storage.onChanged listener', () => {
      expect(storageChangedListeners.length).toBeGreaterThan(0);
    });

    it('registers a tabs.onRemoved listener', () => {
      expect(tabsRemovedListeners.length).toBeGreaterThan(0);
    });
  });

  // ── get-state ──────────────────────────────────────────────────────────

  describe('get-state', () => {
    it('returns current state as idle by default', async () => {
      const response = await sendMessageToSW({ action: 'get-state' });
      expect(response.ok).toBe(true);
      expect(response.state).toBe('idle');
    });
  });

  // ── cancel-agent-loop ──────────────────────────────────────────────────

  describe('cancel-agent-loop', () => {
    it('acknowledges cancellation', async () => {
      const response = await sendMessageToSW({ action: 'cancel-agent-loop' });
      expect(response.ok).toBe(true);
    });
  });

  // ── clear-conversation ─────────────────────────────────────────────────

  describe('clear-conversation', () => {
    it('clears conversation and sends info back to tab', async () => {
      const tabId = 42;
      const response = await sendMessageToSW(
        { action: 'clear-conversation' },
        { tab: { id: tabId } as chrome.tabs.Tab }
      );

      expect(response.ok).toBe(true);
      // Should send conversation-info back to the tab
      expect(mockTabsSendMessage).toHaveBeenCalledWith(
        tabId,
        expect.objectContaining({
          action: 'conversation-info',
          info: expect.objectContaining({
            turns: 0,
            maxTurns: 20,
          }),
        })
      );
    });
  });

  // ── get-conversation-info ──────────────────────────────────────────────

  describe('get-conversation-info', () => {
    it('returns conversation info for a tab', async () => {
      const response = await sendMessageToSW(
        { action: 'get-conversation-info' },
        { tab: { id: 99 } as chrome.tabs.Tab }
      );

      expect(response.ok).toBe(true);
      expect(response.info).toBeDefined();
      expect(response.info.turns).toBe(0);
      expect(response.info.maxTurns).toBe(20);
    });

    it('returns default info when no tab id', async () => {
      const response = await sendMessageToSW(
        { action: 'get-conversation-info' },
        {} // no tab
      );

      expect(response.ok).toBe(true);
      expect(response.info.turns).toBe(0);
    });
  });

  // ── open-welcome ───────────────────────────────────────────────────────

  describe('open-welcome', () => {
    it('opens welcome tab', async () => {
      const response = await sendMessageToSW({ action: 'open-welcome' });
      expect(response.ok).toBe(true);
      expect(mockTabsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringContaining('welcome.html') })
      );
    });
  });

  // ── check-mic-permission ───────────────────────────────────────────────

  describe('check-mic-permission', () => {
    it('responds with ok', async () => {
      const response = await sendMessageToSW({ action: 'check-mic-permission' });
      expect(response.ok).toBe(true);
    });
  });

  // ── unknown action ─────────────────────────────────────────────────────

  describe('unknown action', () => {
    it('returns error for unknown actions', async () => {
      const response = await sendMessageToSW({ action: 'some-unknown-action' });
      expect(response.ok).toBe(false);
      expect(response.error).toContain('Unknown action');
    });
  });

  // ── offscreen messages are ignored ─────────────────────────────────────

  describe('offscreen messages', () => {
    it('ignores messages with target=offscreen', () => {
      const handler = getMessageHandler();
      const sendResponse = jest.fn();

      const result = handler(
        { action: 'start-recording', target: 'offscreen' },
        {},
        sendResponse
      );

      // Should return false (not handled)
      expect(result).toBe(false);
      expect(sendResponse).not.toHaveBeenCalled();
    });
  });

  // ── shortcut-hold ──────────────────────────────────────────────────────

  describe('shortcut-hold', () => {
    it('starts recording and returns listening state', async () => {
      const response = await sendMessageToSW(
        { action: 'shortcut-hold', cursorX: 100, cursorY: 200 },
        { tab: { id: 10 } as chrome.tabs.Tab }
      );

      expect(response.ok).toBe(true);
      expect(response.state).toBe('listening');
    });

    it('sends start-listening to the recording tab', async () => {
      await sendMessageToSW(
        { action: 'shortcut-hold', cursorX: 50, cursorY: 50 },
        { tab: { id: 15 } as chrome.tabs.Tab }
      );

      // Should send start-listening to the tab
      expect(mockTabsSendMessage).toHaveBeenCalledWith(
        15,
        expect.objectContaining({ action: 'start-listening' })
      );
    });

    it('updates toolbar icon to recording', async () => {
      await sendMessageToSW(
        { action: 'shortcut-hold', cursorX: 0, cursorY: 0 },
        { tab: { id: 10 } as chrome.tabs.Tab }
      );

      expect(mockSetBadgeText).toHaveBeenCalledWith({ text: 'REC' });
      expect(mockSetBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#F44336' });
    });
  });

  // ── shortcut-release ───────────────────────────────────────────────────

  describe('shortcut-release', () => {
    it('transitions to processing state', async () => {
      const response = await sendMessageToSW(
        { action: 'shortcut-release', cursorX: 100, cursorY: 200 },
        { tab: { id: 10 } as chrome.tabs.Tab }
      );

      expect(response.ok).toBe(true);
      expect(response.state).toBe('processing');
    });

    it('sends bubble-state transcribing to the tab', async () => {
      await sendMessageToSW(
        { action: 'shortcut-release', cursorX: 0, cursorY: 0 },
        { tab: { id: 12 } as chrome.tabs.Tab }
      );

      expect(mockTabsSendMessage).toHaveBeenCalledWith(
        12,
        expect.objectContaining({ action: 'bubble-state', state: 'transcribing' })
      );
    });
  });

  // ── follow-up ──────────────────────────────────────────────────────────

  describe('follow-up', () => {
    it('acknowledges follow-up message', async () => {
      const response = await sendMessageToSW(
        { action: 'follow-up', text: 'tell me more' },
        { tab: { id: 20 } as chrome.tabs.Tab }
      );

      expect(response.ok).toBe(true);
    });

    it('calls sendTask for answer-type follow-up', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'answer',
        text: 'The price is $29.99',
        reasoning: 'Found price element',
      });

      await runFollowUpAndWait(31, 'what is the price?');

      expect(sendTask).toHaveBeenCalled();
      // Should send bubble-answer-chunk to the tab
      expect(mockTabsSendMessage).toHaveBeenCalledWith(
        31,
        expect.objectContaining({ action: 'bubble-answer-chunk' })
      );
    });

    it('sends reasoning to bubble when present in response', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'answer',
        text: 'answer text',
        reasoning: 'This is the reasoning',
      });

      await runFollowUpAndWait(33, 'question');

      expect(mockTabsSendMessage).toHaveBeenCalledWith(
        33,
        expect.objectContaining({
          action: 'bubble-reasoning',
          text: 'This is the reasoning',
        })
      );
    });

    it('sends TTS summary from first sentence of answer', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'answer',
        text: 'The price is $29.99. It was recently reduced from $39.99.',
      });

      await runFollowUpAndWait(34, 'price?');

      expect(mockTabsSendMessage).toHaveBeenCalledWith(
        34,
        expect.objectContaining({
          action: 'tts-summary',
          summary: 'The price is $29.99.',
        })
      );
    });
  });

  // ── Pipeline mutex ────────────────────────────────────────────────────

  describe('pipeline mutex', () => {
    it('blocks concurrent calls with pipelineRunning flag', async () => {
      // Make the first follow-up take a long time
      (sendTask as jest.Mock).mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({ type: 'answer', text: 'slow' }), 2000))
      );

      // Start first follow-up (don't await)
      sendMessageToSW(
        { action: 'follow-up', text: 'first' },
        { tab: { id: 100 } as chrome.tabs.Tab }
      );

      // Wait a bit for the pipeline to start
      await new Promise(r => setTimeout(r, 100));

      // Try a second follow-up while first is running
      await sendMessageToSW(
        { action: 'follow-up', text: 'second' },
        { tab: { id: 101 } as chrome.tabs.Tab }
      );

      // Wait for it
      await new Promise(r => setTimeout(r, 100));

      // The second call should have received the "Please wait" error
      expect(mockTabsSendMessage).toHaveBeenCalledWith(
        101,
        expect.objectContaining({
          action: 'pipeline-error',
          error: expect.stringContaining('Please wait'),
        })
      );

      // Wait for first pipeline to finish
      await new Promise(r => setTimeout(r, 2500));
    }, 10000);
  });

  // ── Agent loop via follow-up triggering steps ──────────────────────────

  describe('agent loop behavior', () => {
    it('executes steps when sendTask returns steps response', async () => {
      const stepsResponse = {
        type: 'steps',
        actions: [
          { action: 'click', selector: '#add-to-cart', description: 'Click add to cart' },
        ],
      };
      (sendTask as jest.Mock).mockResolvedValue(stepsResponse);
      (sendTaskContinue as jest.Mock).mockResolvedValue({ type: 'done' });

      setupAgentLoopMocks({ ok: true, summary: "Clicked 'Add to Cart'" });

      await runFollowUpAndWait(30, 'add item to cart', 3000);

      // sendTask should have been called
      expect(sendTask).toHaveBeenCalled();
      // sendTaskContinue should have been called (re-observation)
      expect(sendTaskContinue).toHaveBeenCalled();
    }, 10000);

    it('records failure in history and re-observes on action failure', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'steps',
        actions: [
          { action: 'click', selector: '#nonexistent', description: 'Click missing element' },
        ],
      });
      (sendTaskContinue as jest.Mock).mockResolvedValue({ type: 'done' });

      mockTabsSendMessage.mockImplementation((_tabId: number, msg: any) => {
        if (msg.action === 'execute-action') {
          return Promise.resolve({ ok: false, summary: '', error: 'Element not found' });
        }
        if (msg.action === 'wait-for-dom-stable') {
          return Promise.resolve({ stable: true });
        }
        if (msg.action === 'scrape-dom') {
          return Promise.resolve({ ok: true, snapshot: { url: 'https://example.com', buttons: [{ selector: '#x', text: 'X' }], inputs: [], links: [] } });
        }
        return Promise.resolve(undefined);
      });

      await runFollowUpAndWait(35, 'click something', 3000);

      // Should have called sendTaskContinue with the failure in history
      expect(sendTaskContinue).toHaveBeenCalled();
      const continueArgs = (sendTaskContinue as jest.Mock).mock.calls[0];
      const history = continueArgs[1]; // actionHistory
      expect(history.length).toBe(1);
      expect(history[0].result).toContain('FAILED');
    }, 10000);

    it('sends bubble-state executing when starting steps', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'steps',
        actions: [
          { action: 'click', selector: '#btn', description: 'Click it' },
        ],
      });
      (sendTaskContinue as jest.Mock).mockResolvedValue({ type: 'done' });

      setupAgentLoopMocks();

      await runFollowUpAndWait(36, 'click', 3000);

      expect(mockTabsSendMessage).toHaveBeenCalledWith(
        36,
        expect.objectContaining({
          action: 'bubble-state',
          state: 'executing',
        })
      );
    }, 10000);

    it('sends bubble-step with action description', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'steps',
        actions: [
          { action: 'click', selector: '#btn', description: 'Click the button' },
        ],
      });
      (sendTaskContinue as jest.Mock).mockResolvedValue({ type: 'done' });

      setupAgentLoopMocks();

      await runFollowUpAndWait(37, 'click', 3000);

      expect(mockTabsSendMessage).toHaveBeenCalledWith(
        37,
        expect.objectContaining({
          action: 'bubble-step',
          stepName: 'Click the button',
        })
      );
    }, 10000);

    it('executes single action per iteration (not batch)', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'steps',
        actions: [
          { action: 'click', selector: '#btn1', description: 'First' },
          { action: 'click', selector: '#btn2', description: 'Second' },
        ],
      });
      // After first action, done
      (sendTaskContinue as jest.Mock).mockResolvedValue({ type: 'done' });

      setupAgentLoopMocks();

      await runFollowUpAndWait(38, 'click buttons', 3000);

      // execute-action should have been called only ONCE (single action per iteration)
      const executeCalls = mockTabsSendMessage.mock.calls.filter(
        (c: any[]) => c[1]?.action === 'execute-action'
      );
      expect(executeCalls.length).toBe(1);
      // It should be the FIRST action
      expect(executeCalls[0][1].description).toBe('First');
    }, 10000);
  });

  // ── sendAgentDone sends TTS summary ───────────────────────────────────

  describe('sendAgentDone TTS', () => {
    it('sends tts-summary with "All done" when task completes', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'steps',
        actions: [
          { action: 'click', selector: '#btn', description: 'Click button' },
        ],
      });
      (sendTaskContinue as jest.Mock).mockResolvedValue({ type: 'done' });

      setupAgentLoopMocks();

      await runFollowUpAndWait(39, 'do stuff', 3000);

      expect(mockTabsSendMessage).toHaveBeenCalledWith(
        39,
        expect.objectContaining({
          action: 'tts-summary',
          summary: 'All done.',
        })
      );
    }, 10000);
  });

  // ── shortSpeak patterns ───────────────────────────────────────────────

  describe('shortSpeak patterns (via agent loop TTS)', () => {
    it('speaks "Clicking X" for generic click actions', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'steps',
        actions: [
          { action: 'click', selector: '#details-btn', description: 'Click details' },
        ],
      });
      (sendTaskContinue as jest.Mock).mockResolvedValue({ type: 'done' });

      setupAgentLoopMocks({ ok: true, summary: "Clicked 'View Details'" });

      await runFollowUpAndWait(41, 'view details', 3000);

      const ttsCalls = mockTabsSendMessage.mock.calls.filter(
        (c: any[]) => c[1]?.action === 'tts-summary' && typeof c[1]?.summary === 'string' && c[1]?.summary.startsWith('Clicking')
      );
      expect(ttsCalls.length).toBeGreaterThanOrEqual(1);
    }, 10000);

    it('speaks "Scrolling" for scroll actions', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'steps',
        actions: [
          { action: 'scroll', direction: 'down', description: 'Scroll down' },
        ],
      });
      (sendTaskContinue as jest.Mock).mockResolvedValue({ type: 'done' });

      setupAgentLoopMocks({ ok: true, summary: 'Scrolled down one screen' });

      await runFollowUpAndWait(42, 'scroll down', 3000);

      const ttsCalls = mockTabsSendMessage.mock.calls.filter(
        (c: any[]) => c[1]?.action === 'tts-summary' && c[1]?.summary === 'Scrolling'
      );
      expect(ttsCalls.length).toBeGreaterThanOrEqual(1);
    }, 10000);

    it('speaks "Added to cart" for add-to-cart clicks', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'steps',
        actions: [
          { action: 'click', selector: '#add-to-cart', description: 'Add to cart' },
        ],
      });
      (sendTaskContinue as jest.Mock).mockResolvedValue({ type: 'done' });

      setupAgentLoopMocks({ ok: true, summary: "Clicked '#add-to-cart-button'" });

      await runFollowUpAndWait(43, 'add to cart', 3000);

      const ttsCalls = mockTabsSendMessage.mock.calls.filter(
        (c: any[]) => c[1]?.action === 'tts-summary' && c[1]?.summary === 'Added to cart'
      );
      expect(ttsCalls.length).toBeGreaterThanOrEqual(1);
    }, 10000);

    it('speaks "Searching X" for type actions', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'steps',
        actions: [
          { action: 'type', selector: '#search', value: 'headphones', description: 'Type headphones' },
        ],
      });
      (sendTaskContinue as jest.Mock).mockResolvedValue({ type: 'done' });

      setupAgentLoopMocks({ ok: true, summary: "Typed 'headphones' into #search" });

      await runFollowUpAndWait(44, 'search headphones', 3000);

      const ttsCalls = mockTabsSendMessage.mock.calls.filter(
        (c: any[]) => c[1]?.action === 'tts-summary' && c[1]?.summary?.startsWith('Searching')
      );
      expect(ttsCalls.length).toBeGreaterThanOrEqual(1);
    }, 10000);

    it('uses Nova speak field when available', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'steps',
        actions: [
          { action: 'click', selector: '#btn', description: 'Click button', speak: 'Clicking checkout' },
        ],
      });
      (sendTaskContinue as jest.Mock).mockResolvedValue({ type: 'done' });

      setupAgentLoopMocks();

      await runFollowUpAndWait(45, 'click checkout', 3000);

      const ttsCalls = mockTabsSendMessage.mock.calls.filter(
        (c: any[]) => c[1]?.action === 'tts-summary' && c[1]?.summary === 'Clicking checkout'
      );
      expect(ttsCalls.length).toBeGreaterThanOrEqual(1);
    }, 10000);
  });

  // ── waitForDomStable ───────────────────────────────────────────────────

  describe('waitForDomStable', () => {
    it('sends wait-for-dom-stable message during agent loop', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'steps',
        actions: [{ action: 'click', selector: '#btn', description: 'Click' }],
      });
      (sendTaskContinue as jest.Mock).mockResolvedValue({ type: 'done' });

      setupAgentLoopMocks();

      await runFollowUpAndWait(40, 'click it', 3000);

      const waitCalls = mockTabsSendMessage.mock.calls.filter(
        (call: any[]) => call[1]?.action === 'wait-for-dom-stable'
      );
      expect(waitCalls.length).toBeGreaterThan(0);
    }, 10000);
  });

  // ── Navigation handling ────────────────────────────────────────────────

  describe('navigation handling', () => {
    it('handles content script disconnect during navigation', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'steps',
        actions: [
          { action: 'navigate', url: 'https://example.com/page2', description: 'Go to page 2' },
        ],
      });
      (sendTaskContinue as jest.Mock).mockResolvedValue({ type: 'done' });

      let executeCallCount = 0;
      mockTabsSendMessage.mockImplementation((_tabId: number, msg: any) => {
        if (msg.action === 'execute-action') {
          executeCallCount++;
          // Simulate content script disconnect on navigation
          return Promise.reject(new Error('Could not establish connection'));
        }
        if (msg.action === 'scrape-dom') {
          // Content script has reconnected
          return Promise.resolve({ ok: true, snapshot: { url: 'https://example.com/page2', buttons: [{ selector: '#x', text: 'X' }], inputs: [], links: [] } });
        }
        if (msg.action === 'wait-for-dom-stable') {
          return Promise.resolve({ stable: true });
        }
        return Promise.resolve(undefined);
      });

      await runFollowUpAndWait(50, 'go to page 2', 5000);

      // Should have attempted scrape-dom after navigation
      const scrapeCalls = mockTabsSendMessage.mock.calls.filter(
        (call: any[]) => call[1]?.action === 'scrape-dom'
      );
      expect(scrapeCalls.length).toBeGreaterThan(0);
    }, 15000);
  });

  // ── Conversation history ───────────────────────────────────────────────

  describe('conversation history', () => {
    it('tracks conversation across follow-ups', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'answer',
        text: 'First answer',
      });

      const tabId = 60;
      await runFollowUpAndWait(tabId, 'first question');

      // Check conversation info
      const infoResponse = await sendMessageToSW(
        { action: 'get-conversation-info' },
        { tab: { id: tabId } as chrome.tabs.Tab }
      );

      expect(infoResponse.ok).toBe(true);
      expect(infoResponse.info.turns).toBe(1);
    });

    it('clears conversation on clear-conversation message', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'answer',
        text: 'An answer',
      });

      const tabId = 61;

      // Add a conversation turn
      await runFollowUpAndWait(tabId, 'question');

      // Clear it
      await sendMessageToSW(
        { action: 'clear-conversation' },
        { tab: { id: tabId } as chrome.tabs.Tab }
      );

      // Verify cleared
      const infoResponse = await sendMessageToSW(
        { action: 'get-conversation-info' },
        { tab: { id: tabId } as chrome.tabs.Tab }
      );

      expect(infoResponse.info.turns).toBe(0);
    });

    it('stores step plans in conversation history', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'steps',
        actions: [
          { action: 'click', selector: '#btn', description: 'Click button' },
        ],
      });
      (sendTaskContinue as jest.Mock).mockResolvedValue({ type: 'done' });

      setupAgentLoopMocks();

      const tabId = 62;
      await runFollowUpAndWait(tabId, 'click the button', 3000);

      const infoResponse = await sendMessageToSW(
        { action: 'get-conversation-info' },
        { tab: { id: tabId } as chrome.tabs.Tab }
      );

      // Steps also count as a conversation turn
      expect(infoResponse.info.turns).toBe(1);
    }, 10000);
  });

  // ── Lifecycle: onInstalled ─────────────────────────────────────────────

  describe('onInstalled', () => {
    it('opens welcome tab on fresh install', () => {
      expect(onInstalledListeners.length).toBeGreaterThan(0);
      const handler = onInstalledListeners[0];
      handler({ reason: 'install' });
      expect(mockTabsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringContaining('welcome.html') })
      );
    });

    it('does not open welcome tab on update', () => {
      mockTabsCreate.mockClear();
      const handler = onInstalledListeners[0];
      handler({ reason: 'update' });
      // Should not create welcome tab on update (just resolveIconState)
      expect(mockTabsCreate).not.toHaveBeenCalled();
    });
  });

  // ── Tabs onRemoved cleans up conversations ─────────────────────────────

  describe('tabs.onRemoved', () => {
    it('cleans up conversation when tab is removed', async () => {
      const tabId = 70;
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'answer',
        text: 'answer',
      });

      // Add conversation
      await runFollowUpAndWait(tabId, 'q');

      // Verify conversation exists
      let info = await sendMessageToSW(
        { action: 'get-conversation-info' },
        { tab: { id: tabId } as chrome.tabs.Tab }
      );
      expect(info.info.turns).toBe(1);

      // Simulate tab removal
      expect(tabsRemovedListeners.length).toBeGreaterThan(0);
      tabsRemovedListeners[0](tabId);

      // Verify conversation is cleaned up
      info = await sendMessageToSW(
        { action: 'get-conversation-info' },
        { tab: { id: tabId } as chrome.tabs.Tab }
      );
      expect(info.info.turns).toBe(0);
    });
  });

  // ── Agent loop cancel after sendTaskContinue ──────────────────────────

  describe('agent loop cancellation', () => {
    it('cancels after sendTaskContinue returns', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'steps',
        actions: [{ action: 'click', selector: '#btn', description: 'Click' }],
      });

      // sendTaskContinue returns more steps (never done) — but we'll cancel first
      let continueCallCount = 0;
      (sendTaskContinue as jest.Mock).mockImplementation(() => {
        continueCallCount++;
        if (continueCallCount === 1) {
          // During the first re-observation, trigger cancel
          return new Promise(resolve => {
            setTimeout(() => {
              // Send cancel message
              sendMessageToSW({ action: 'cancel-agent-loop' });
              resolve({
                type: 'steps',
                actions: [{ action: 'click', selector: '#btn2', description: 'Click 2' }],
              });
            }, 100);
          });
        }
        return Promise.resolve({ type: 'done' });
      });

      setupAgentLoopMocks();

      await runFollowUpAndWait(81, 'keep clicking', 5000);

      // Should have sent bubble-state done with "Cancelled" label
      const doneCalls = mockTabsSendMessage.mock.calls.filter(
        (c: any[]) => c[1]?.action === 'bubble-state' && c[1]?.state === 'done' && c[1]?.label === 'Cancelled'
      );
      expect(doneCalls.length).toBeGreaterThanOrEqual(1);
    }, 15000);
  });

  // ── MAX_AGENT_ITERATIONS ───────────────────────────────────────────────

  describe('MAX_AGENT_ITERATIONS limit', () => {
    it('stops after maximum iterations when Nova keeps returning steps', async () => {
      (sendTask as jest.Mock).mockResolvedValue({
        type: 'steps',
        actions: [{ action: 'click', selector: '#btn', description: 'Click' }],
      });
      // sendTaskContinue always returns more steps (never done)
      (sendTaskContinue as jest.Mock).mockResolvedValue({
        type: 'steps',
        actions: [{ action: 'click', selector: '#btn2', description: 'Click again' }],
      });

      setupAgentLoopMocks();

      await runFollowUpAndWait(80, 'keep clicking', 8000);

      // Should eventually reach max iterations and send done
      expect(mockTabsSendMessage).toHaveBeenCalledWith(
        80,
        expect.objectContaining({
          action: 'bubble-state',
          state: 'done',
        })
      );

      // sendTaskContinue should have been called multiple times but capped at MAX_AGENT_ITERATIONS (25)
      const continueCallCount = (sendTaskContinue as jest.Mock).mock.calls.length;
      expect(continueCallCount).toBeLessThanOrEqual(25);
      expect(continueCallCount).toBeGreaterThan(0);
    }, 30000);
  });
});
