/**
 * Offscreen document lifecycle management.
 *
 * Handles creating / waiting-for the offscreen document used for
 * microphone recording, and forwarding amplitude data to content scripts.
 */

// ─── State ───

let offscreenReady = false;
let ensureOffscreenInFlight: Promise<void> | null = null;

// Resolves when the offscreen document has loaded its script and sent 'offscreen-ready'.
let offscreenReadyResolve: (() => void) | null = null;
let offscreenReadyPromise: Promise<void> | null = null;

// ─── Public API ───

/**
 * Ensure the offscreen document exists and is ready to receive messages.
 * De-duplicates concurrent calls.
 */
export async function ensureOffscreen(): Promise<void> {
  if (ensureOffscreenInFlight) return ensureOffscreenInFlight;
  ensureOffscreenInFlight = _ensureOffscreen().finally(() => { ensureOffscreenInFlight = null; });
  return ensureOffscreenInFlight;
}

/**
 * Called when the offscreen document sends its 'offscreen-ready' message.
 * Resolves the promise that `ensureOffscreen` is waiting on.
 */
export function handleOffscreenReady(): void {
  console.log('[ScreenSense][SW] Offscreen document script loaded');
  if (offscreenReadyResolve) {
    offscreenReadyResolve();
    offscreenReadyResolve = null;
  }
}

/**
 * Forward amplitude data from the offscreen document to the recording tab's
 * content script so the waveform visualiser can display it.
 */
export function forwardAmplitude(
  data: number[],
  recordingTabId: number | null,
  swAmpLogged: boolean,
): boolean {
  if (recordingTabId) {
    if (!swAmpLogged) {
      console.log('[ScreenSense][SW] forwarding amplitude to tab', recordingTabId, 'dataLen=', data?.length, 'first8=', data?.slice(0, 8));
    }
    chrome.tabs.sendMessage(recordingTabId, {
      action: 'amplitude-data',
      data,
    }).catch((err) => console.error('[ScreenSense] amplitude-data forward to tab:', err));
  } else {
    console.warn('[ScreenSense][SW] amplitude received but recordingTabId is null');
  }
  // Return true to indicate the log has been emitted (so caller can update its flag)
  return true;
}

// ─── Internal ───

async function _ensureOffscreen(): Promise<void> {
  const contexts = await (chrome.runtime as unknown as { getContexts: (filter: object) => Promise<unknown[]> }).getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });

  if (contexts && contexts.length > 0) {
    offscreenReady = true;
    return;
  }

  // Create a promise that resolves when the offscreen document signals it's ready
  offscreenReadyPromise = new Promise<void>((resolve) => {
    offscreenReadyResolve = resolve;
  });

  console.log('[ScreenSense][SW] Creating offscreen document...');
  await (chrome as unknown as { offscreen: { createDocument: (opts: object) => Promise<void> } }).offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Microphone recording for voice queries',
  });

  // Wait for the offscreen script to load and register its listener.
  // The offscreen document sends an 'offscreen-ready' message on load.
  // Use a timeout fallback in case the ready message is missed.
  await Promise.race([
    offscreenReadyPromise,
    new Promise<void>((resolve) => setTimeout(resolve, 500)),
  ]);

  offscreenReady = true;
  console.log('[ScreenSense][SW] Offscreen document ready');
}
