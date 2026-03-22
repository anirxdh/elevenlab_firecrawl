import './content.css';
import { initShortcutHandler } from './shortcut-handler';
import { CursorBubble } from './cursor-bubble';
import { stop as stopTts } from './tts';
import { scrapeDom } from './dom-scraper';
import { executeAction } from './action-executor';

const isTopFrame = window === window.top;

// Shortcut handler runs in ALL frames (needed for Google Docs iframes)
initShortcutHandler();

// Everything below only runs in the top frame
if (!isTopFrame) {
  // Stop here for iframes — shortcut handler is enough
} else {

const bubble = new CursorBubble();

let lastCursorX = 0;
let lastCursorY = 0;
let contentAmpLogged = false;

// Lightweight mouse tracking for initial show position only
// CursorBubble handles its own tracking internally once shown
document.addEventListener('mousemove', (e: MouseEvent) => {
  lastCursorX = e.clientX;
  lastCursorY = e.clientY;
}, { passive: true });

// Safe message sender — prevents unhandled promise rejections
function sendMessage(msg: Record<string, unknown>): void {
  chrome.runtime.sendMessage(msg).catch((err) => console.error('[ScreenSense] message send:', err));
}

// Wire up bubble callbacks for follow-up and clear
bubble.setCallbacks(
  (text: string) => sendMessage({ action: 'follow-up', text }),
  () => { bubble.clearChatHistory(); sendMessage({ action: 'clear-conversation' }); }
);

// Cancel agent loop when Escape is pressed while bubble is visible
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && bubble.isVisible()) {
    chrome.runtime.sendMessage({ action: 'cancel-agent-loop' }).catch((err) => console.error('[ScreenSense] cancel-agent-loop send (Escape):', err));
  }
}, true);

async function onHold(event: Event): Promise<void> {
  const detail = (event as CustomEvent).detail;
  lastCursorX = detail.cursorX;
  lastCursorY = detail.cursorY;
  contentAmpLogged = false;

  // Stop TTS when user starts recording again
  stopTts();

  // If bubble is visible and in executing/understanding state, cancel the agent loop first
  if (bubble.isVisible()) {
    chrome.runtime.sendMessage({ action: 'cancel-agent-loop' }).catch((err) => console.error('[ScreenSense] cancel-agent-loop send (hold):', err));
    // Don't await — let cancel propagate in background
  }

  // Show the bubble at cursor position in listening state
  bubble.show(lastCursorX, lastCursorY);
  bubble.setState('listening');
}

async function onRelease(event: Event): Promise<void> {
  const detail = (event as CustomEvent).detail;

  // If this is an auto-stop synthetic release, skip (already handled)
  if (detail?.autoStop) return;

  // Ensure bubble is visible
  if (!bubble.isVisible()) {
    bubble.show(lastCursorX, lastCursorY);
  } else {
    // If bubble was already visible (follow-up context), prepare for new content
    bubble.prepareForFollowUp();
  }
  // Do NOT set state here — SSE events from the backend will drive state transitions
}

// Listen for messages from background (pipeline stages, streaming, errors, amplitude)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Handle wait-for-dom-stable — MutationObserver-based page stability check
  if (message.action === 'wait-for-dom-stable') {
    const timeout = message.timeout || 2000;
    const settleMs = message.settleMs || 300;

    const result = new Promise<{ stable: boolean }>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      let settled = false;

      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          settled = true;
          observer.disconnect();
          resolve({ stable: true });
        }, settleMs);
      });

      observer.observe(document.body, {
        childList: true, subtree: true, attributes: true, characterData: true
      });

      // Start the settle timer (in case no mutations happen — page is already stable)
      timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          observer.disconnect();
          resolve({ stable: true });
        }
      }, settleMs);

      // Hard timeout
      setTimeout(() => {
        if (!settled) {
          settled = true;
          observer.disconnect();
          resolve({ stable: false });
        }
      }, timeout);
    });

    result.then((res) => sendResponse(res));
    return true;
  }

  // Handle cancel-agent-loop — service worker sets the cancel flag
  if (message.action === 'cancel-agent-loop') {
    sendResponse({ ok: true });
    return false;
  }

  // Handle execute-action — needs async sendResponse
  if (message.action === 'execute-action') {
    // Execute the DOM action and return result asynchronously
    executeAction({
      actionType: message.actionType,
      selector: message.selector,
      value: message.value,
      url: message.url,
      direction: message.direction,
      description: message.description,
    }).then((result) => {
      sendResponse(result);
    });
    return true; // keep message channel open for async sendResponse
  }

  // Handle scrape-dom — keep port open for large payload serialization
  if (message.action === 'scrape-dom') {
    try {
      const snapshot = scrapeDom();
      sendResponse({ ok: true, snapshot });
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error).message });
    }
    return true;
  }

  // Handle bubble visibility for screenshot capture
  if (message.action === 'hide-overlay') {
    bubble.hideForScreenshot();
    sendResponse({ ok: true });
    return false;
  } else if (message.action === 'show-overlay') {
    bubble.showAfterScreenshot();
    sendResponse({ ok: true });
    return false;
  }

  if (message.action === 'bubble-state') {
    // Auto-show bubble near cursor if not visible (e.g., after page navigation)
    if (!bubble.isVisible() && message.state !== 'idle') {
      bubble.show(lastCursorX || window.innerWidth / 2, lastCursorY || 80);
    }
    bubble.setState(message.state, message.label);
  } else if (message.action === 'bubble-answer-chunk') {
    bubble.appendChunk(message.text);
  } else if (message.action === 'bubble-answer-done') {
    bubble.onAnswerDone();
  } else if (message.action === 'bubble-step') {
    if (!bubble.isVisible()) {
      bubble.show(lastCursorX || window.innerWidth / 2, lastCursorY || 80);
      bubble.setState('executing');
    }
    bubble.setStep(message.stepName, message.stepIndex, message.totalSteps);
  } else if (message.action === 'amplitude-data') {
    const freqData = new Uint8Array(message.data);
    if (!contentAmpLogged) {
      const max = Math.max(...message.data);
      console.log('[ScreenSense][content] amplitude-data received, len=', message.data.length, 'max=', max, 'bubbleVisible=', bubble.isVisible());
      contentAmpLogged = true;
    }
    bubble.updateAmplitude(freqData);
  } else if (message.action === 'tts-summary') {
    bubble.speakSummary(message.summary);
  } else if (message.action === 'conversation-info') {
    bubble.updateConversationInfo(message.info);
  } else if (message.action === 'pipeline-error') {
    if (!bubble.isVisible()) {
      bubble.show(lastCursorX || window.innerWidth / 2, lastCursorY || 80);
    }
    bubble.showError(message.error);
  } else if (message.action === 'start-listening') {
    // Fallback: service worker tells us to show listening UI (handles iframe case
    // where the screensense-hold custom event fires on the wrong document)
    if (!bubble.isVisible()) {
      bubble.show(lastCursorX, lastCursorY);
      bubble.setState('listening');
    }
  } else if (message.action === 'bubble-reasoning') {
    bubble.showReasoning(message.text);
  } else if (message.action === 'bubble-set-task') {
    bubble.setTask(message.task);
  } else if (message.action === 'bubble-done-summary') {
    bubble.showDoneSummary(message.steps);
  }
});

// Listen for shortcut custom events
document.addEventListener('screensense-hold', onHold);
document.addEventListener('screensense-release', onRelease);

console.log('[ScreenSense] Content script loaded');

} // end isTopFrame
