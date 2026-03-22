/**
 * Registration-based Chrome message router.
 *
 * Replaces the giant switch/if-else chain in service-worker.ts with a
 * registry that maps action names to handler functions.
 */

import { MessageType } from '../shared/types';

/**
 * A message handler receives the message, the sender, and the sendResponse
 * callback.  Return `true` if the response will be sent asynchronously
 * (same semantics as `chrome.runtime.onMessage`).
 */
export type MessageHandler = (
  message: MessageType & Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

// ─── Registry ───

const handlers = new Map<string, MessageHandler>();

/**
 * Register a handler for a specific `action` value.
 * Only one handler per action is allowed — later registrations overwrite.
 */
export function registerHandler(action: string, handler: MessageHandler): void {
  handlers.set(action, handler);
}

/**
 * Install the master `chrome.runtime.onMessage` listener that delegates to
 * the registered handlers.
 *
 * Call this once during service-worker bootstrap.
 */
export function initMessageRouter(): void {
  chrome.runtime.onMessage.addListener(
    (
      message: MessageType & { target?: string },
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      // Ignore messages meant for offscreen document
      if (message.target === 'offscreen') return false;

      const handler = handlers.get(message.action);
      if (handler) {
        return handler(
          message as MessageType & Record<string, unknown>,
          sender,
          sendResponse,
        );
      }

      // No handler registered — unknown action
      sendResponse({ ok: false, error: 'Unknown action' });
      return false;
    },
  );
}
