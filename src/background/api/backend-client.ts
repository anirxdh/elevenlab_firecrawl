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
  domSnapshot: object
): Promise<TaskResponse> {
  console.log('[ScreenSense][backend-client] sendTask called — command:', command);

  // Strip the data:image/png;base64, prefix to get raw base64
  const base64 = screenshotDataUrl.replace(/^data:image\/\w+;base64,/, '');

  const response = await fetch(`${BACKEND_URL}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command,
      screenshot: base64,
      dom_snapshot: domSnapshot,
    }),
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
  domSnapshot: object
): Promise<TaskResponse> {
  console.log('[ScreenSense][backend-client] sendTaskContinue called — command:', originalCommand, 'history length:', actionHistory.length);

  // Strip the data:image/png;base64, prefix to get raw base64
  const base64 = screenshotDataUrl.replace(/^data:image\/\w+;base64,/, '');

  const response = await fetch(`${BACKEND_URL}/task/continue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      original_command: originalCommand,
      action_history: actionHistory,
      screenshot: base64,
      dom_snapshot: domSnapshot,
    }),
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
