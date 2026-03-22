import { BACKEND_URL } from '../../shared/constants';

/**
 * Connect to the backend SSE /events endpoint.
 * Returns an EventSource that emits "status" events.
 *
 * Usage:
 *   const es = connectSSE();
 *   es.addEventListener('status', (e) => {
 *     const data = JSON.parse(e.data);
 *     console.log('Stage:', data.stage);
 *   });
 */
export function connectSSE(): EventSource {
  return new EventSource(`${BACKEND_URL}/events`);
}

export interface TaskResponse {
  type: 'answer' | 'steps' | 'done';
  text?: string;
  summary?: string;  // used when type === 'done'
  reasoning?: string;  // Nova's explanation of its decision
  actions?: Array<{
    action: string;
    selector?: string;
    value?: string;
    url?: string;
    direction?: string;
    description: string;
    speak?: string;  // 3-5 word TTS phrase from Nova
  }>;
  // Conversational response fields
  needs_clarification?: boolean;
  question?: string;
  options?: string[];
  suggestion?: string;
  requires_confirmation?: boolean;
  speak?: string;  // standalone speech without actions
  intent?: string; // classified intent: new_task | reply | follow_up | correction | interruption
  research?: { urls: string[] };
}

export interface ActionHistoryEntry {
  description: string;
  result: string;
}

/**
 * Send a task (command + screenshot + DOM) to the backend for Nova 2 Lite reasoning.
 */
export async function sendTask(
  command: string,
  screenshotDataUrl: string,
  domSnapshot: object,
  firecrawlMarkdown?: string,
  conversationHistory?: Array<{ role: string; content: string }>,
): Promise<TaskResponse> {
  console.log('[ScreenSense][backend-client] sendTask called — command:', command);

  // Strip the data:image/png;base64, prefix to get raw base64
  const base64 = screenshotDataUrl.replace(/^data:image\/\w+;base64,/, '');

  const body: Record<string, unknown> = {
    command,
    screenshot: base64,
    dom_snapshot: domSnapshot,
  };
  if (firecrawlMarkdown) body.firecrawl_markdown = firecrawlMarkdown;
  if (conversationHistory?.length) body.conversation_history = conversationHistory;

  const response = await fetch(`${BACKEND_URL}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  console.log('[ScreenSense][backend-client] /task response status:', response.status);

  if (!response.ok) {
    let detail = '';
    try {
      const errBody = await response.json();
      detail = errBody?.detail || JSON.stringify(errBody);
    } catch {
      detail = `HTTP ${response.status}`;
    }

    console.error('[ScreenSense][backend-client] /task error:', detail);

    if (response.status === 500 && detail.includes('credentials')) {
      throw new Error('Backend AWS credentials not configured — check backend/.env');
    }
    throw new Error(`Task processing failed — ${detail}`);
  }

  const result = await response.json();
  console.log('[ScreenSense][backend-client] Task result type:', result.type);
  return result;
}

/**
 * Continue a multi-step task by sending updated page state + action history to Nova.
 * Called after each action batch during the agent loop.
 */
export async function sendTaskContinue(
  originalCommand: string,
  actionHistory: ActionHistoryEntry[],
  screenshotDataUrl: string,
  domSnapshot: object,
  firecrawlMarkdown?: string,
  conversationHistory?: Array<{ role: string; content: string }>,
): Promise<TaskResponse> {
  console.log('[ScreenSense][backend-client] sendTaskContinue called — command:', originalCommand, 'history length:', actionHistory.length);

  // Strip the data:image/png;base64, prefix to get raw base64
  const base64 = screenshotDataUrl.replace(/^data:image\/\w+;base64,/, '');

  const body: Record<string, unknown> = {
    original_command: originalCommand,
    action_history: actionHistory,
    screenshot: base64,
    dom_snapshot: domSnapshot,
  };
  if (firecrawlMarkdown) body.firecrawl_markdown = firecrawlMarkdown;
  if (conversationHistory?.length) body.conversation_history = conversationHistory;

  const response = await fetch(`${BACKEND_URL}/task/continue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  console.log('[ScreenSense][backend-client] /task/continue response status:', response.status);

  if (!response.ok) {
    let detail = '';
    try {
      const errBody = await response.json();
      detail = errBody?.detail || JSON.stringify(errBody);
    } catch {
      detail = `HTTP ${response.status}`;
    }

    console.error('[ScreenSense][backend-client] /task/continue error:', detail);

    if (response.status === 500 && detail.includes('credentials')) {
      throw new Error('Backend AWS credentials not configured — check backend/.env');
    }
    throw new Error(`Continue task failed — ${detail}`);
  }

  const result = await response.json();
  console.log('[ScreenSense][backend-client] Continue result type:', result.type);
  return result;
}

/**
 * Scrape a URL and return its content as Markdown via Firecrawl.
 */
export async function scrapeUrl(url: string): Promise<string> {
  const resp = await fetch(`${BACKEND_URL}/firecrawl/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(`Scrape failed: ${err.detail}`);
  }
  const data = await resp.json();
  return data.markdown;
}

/**
 * Extract structured data from one or more URLs via Firecrawl.
 */
export async function extractData(
  urls: string[],
  prompt: string,
  schema?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${BACKEND_URL}/firecrawl/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, prompt, schema_def: schema }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(`Extract failed: ${err.detail}`);
  }
  const data = await resp.json();
  return data.data;
}

/**
 * Check if the backend is reachable.
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
