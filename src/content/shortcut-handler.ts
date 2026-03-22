import { getSettings, isMicPermissionGranted } from '../shared/storage';
import { ExtensionSettings } from '../shared/types';

let shortcutKey = '`';
let holdDelayMs = 200;
let keyHeld = false;
let holdActive = false;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let cursorX = 0;
let cursorY = 0;
let lastMoveTime = 0;
let micPermissionCached = false;

async function loadSettings(): Promise<void> {
  const settings: ExtensionSettings = await getSettings();
  shortcutKey = settings.shortcutKey;
  holdDelayMs = settings.holdDelayMs;
}

async function loadMicPermission(): Promise<void> {
  micPermissionCached = await isMicPermissionGranted();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== shortcutKey) return;

  // Prevent key repeat from re-triggering
  if (keyHeld) return;

  console.log('[ScreenSense] KEY DOWN - backtick held');
  keyHeld = true;

  // Prevent the character from being typed
  event.preventDefault();
  event.stopImmediatePropagation();

  // Start the hold delay timer
  holdTimer = setTimeout(() => {
    holdActive = true;

    if (!micPermissionCached) {
      // Mic not granted -- open welcome tab instead
      sendMsg({ action: 'open-welcome' });
      return;
    }

    // Fire hold event
    sendMsg({
      action: 'shortcut-hold',
      cursorX,
      cursorY,
    });

    // Emit custom event for content script UI (overlay indicator in Plan 02)
    document.dispatchEvent(
      new CustomEvent('screensense-hold', {
        detail: { cursorX, cursorY },
      })
    );
  }, holdDelayMs);
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.key !== shortcutKey) return;

  console.log('[ScreenSense] KEY UP - backtick released');
  event.preventDefault();
  event.stopImmediatePropagation();

  if (holdActive) {
    // Fire release event
    sendMsg({
      action: 'shortcut-release',
      cursorX,
      cursorY,
    });

    // Emit custom event for content script UI
    document.dispatchEvent(
      new CustomEvent('screensense-release', {
        detail: { cursorX, cursorY },
      })
    );
  }

  // Clean up
  if (holdTimer !== null) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
  keyHeld = false;
  holdActive = false;
}

function onMouseMove(event: MouseEvent): void {
  // Throttle to ~50ms
  const now = Date.now();
  if (now - lastMoveTime < 50) return;
  lastMoveTime = now;

  cursorX = event.clientX;
  cursorY = event.clientY;
}

function onWindowBlur(): void {
  // If key is held when window loses focus, treat as release
  if (keyHeld) {
    if (holdActive) {
      chrome.runtime.sendMessage({
        action: 'shortcut-release',
        cursorX,
        cursorY,
      });

      document.dispatchEvent(
        new CustomEvent('screensense-release', {
          detail: { cursorX, cursorY },
        })
      );
    }

    if (holdTimer !== null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    keyHeld = false;
    holdActive = false;
  }
}

function onStorageChanged(
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string
): void {
  if (areaName !== 'local') return;

  if (changes['screensense-settings']) {
    const newSettings = changes['screensense-settings'].newValue;
    if (newSettings) {
      shortcutKey = newSettings.shortcutKey ?? shortcutKey;
      holdDelayMs = newSettings.holdDelayMs ?? holdDelayMs;
    }
  }

  if (changes['screensense-mic-granted']) {
    micPermissionCached = changes['screensense-mic-granted'].newValue === true;
  }
}

// Safe message sender — prevents unhandled promise rejections in MV3
function sendMsg(msg: Record<string, unknown>): void {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

export function initShortcutHandler(): void {
  // Load initial settings and mic permission state
  loadSettings();
  loadMicPermission();

  // Use capture phase (3rd argument = true) so events fire before page handlers
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('blur', onWindowBlur);

  // Listen for storage changes to update settings dynamically
  chrome.storage.onChanged.addListener(onStorageChanged);

  console.log('[ScreenSense] Shortcut handler initialized');
}
