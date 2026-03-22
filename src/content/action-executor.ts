/**
 * DOM Action Executor — Phase 9
 *
 * Executes structured DOM actions (click, type, navigate, extract, scroll)
 * with a strict allowlist, selector sanitization, and rate limiting.
 */

export interface ActionRequest {
  actionType: string;
  selector?: string;
  value?: string;
  url?: string;
  direction?: string;
  description: string;
}

export interface ActionResult {
  ok: boolean;
  summary: string;
  error?: string;
  extractedText?: string;
}

// ─── Allowlist ────────────────────────────────────────────────────────────────

const ALLOWED_ACTIONS = new Set(['click', 'type', 'navigate', 'extract', 'scroll']);

// ─── Element highlighting ─────────────────────────────────────────────────────

async function highlightElement(el: Element): Promise<void> {
  const htmlEl = el as HTMLElement;
  const originalOutline = htmlEl.style.outline;
  const originalTransition = htmlEl.style.transition;
  htmlEl.style.transition = 'outline 0.15s ease';
  htmlEl.style.outline = '2px solid rgba(48, 209, 88, 0.9)';
  htmlEl.style.outlineOffset = '2px';
  await new Promise(r => setTimeout(r, 150));
  htmlEl.style.outline = originalOutline;
  htmlEl.style.transition = originalTransition;
  htmlEl.style.outlineOffset = '';
}

async function scrollIntoViewAndRetry(selector: string): Promise<Element | null> {
  const el = document.querySelector(selector);
  if (!el) return null;
  (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
  await new Promise(r => setTimeout(r, 500));
  return document.querySelector(selector);
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

let lastActionTime = 0;
const MIN_ACTION_INTERVAL_MS = 300;
let actionQueue: Promise<void> = Promise.resolve();

async function enforceRateLimit(): Promise<void> {
  return new Promise<void>((resolve) => {
    actionQueue = actionQueue.then(async () => {
      const now = Date.now();
      const elapsed = now - lastActionTime;
      if (elapsed < MIN_ACTION_INTERVAL_MS) {
        await new Promise<void>((r) => setTimeout(r, MIN_ACTION_INTERVAL_MS - elapsed));
      }
      lastActionTime = Date.now();
      resolve();
    });
  });
}

// ─── Selector sanitizer ───────────────────────────────────────────────────────

const DANGEROUS_SELECTOR_PATTERNS = [
  /javascript:/i,
  /<script/i,
  /on\w+=\s*['"]/i, // onclick=', onerror="
  /`/,
];

function sanitizeSelector(selector: string): { ok: boolean; error?: string } {
  for (const pattern of DANGEROUS_SELECTOR_PATTERNS) {
    if (pattern.test(selector)) {
      return { ok: false, error: `Dangerous selector pattern detected: ${pattern}` };
    }
  }
  // Test that the selector is syntactically valid
  try {
    document.querySelector(selector);
  } catch (e) {
    return { ok: false, error: `Invalid selector syntax: ${(e as Error).message}` };
  }
  return { ok: true };
}

function queryElement(selector: string): { el: Element | null; error?: string } {
  const sanitized = sanitizeSelector(selector);
  if (!sanitized.ok) {
    return { el: null, error: sanitized.error };
  }
  try {
    const el = document.querySelector(selector);
    return { el };
  } catch (e) {
    return { el: null, error: (e as Error).message };
  }
}

// ─── Action implementations ───────────────────────────────────────────────────

async function actionClick(selector: string): Promise<ActionResult> {
  let { el, error } = queryElement(selector);
  if (error) return { ok: false, summary: '', error };

  if (!el) {
    // Retry: scroll into view and re-query
    el = await scrollIntoViewAndRetry(selector);
    if (!el) return { ok: false, summary: '', error: `Element not found: ${selector}` };
  }

  await highlightElement(el);

  try {
    (el as HTMLElement).click();
  } catch {
    // Fallback: dispatch MouseEvent
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  const label = el.textContent?.trim().slice(0, 50) || selector;
  return { ok: true, summary: `Clicked '${label}'` };
}

async function actionTypeText(selector: string, value: string): Promise<ActionResult> {
  let { el, error } = queryElement(selector);
  if (error) return { ok: false, summary: '', error };

  if (!el) {
    // Retry: scroll into view and re-query
    el = await scrollIntoViewAndRetry(selector);
    if (!el) return { ok: false, summary: '', error: `Element not found: ${selector}` };
  }

  await highlightElement(el);

  const input = el as HTMLInputElement;
  input.focus();
  // Use native setter to work with React/Vue controlled inputs
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  // Auto-submit search boxes by pressing Enter
  const isSearch = input.type === 'search' ||
    input.getAttribute('role') === 'searchbox' ||
    input.getAttribute('aria-label')?.toLowerCase().includes('search') ||
    input.name?.toLowerCase().includes('search') ||
    input.name?.toLowerCase().includes('keyword') ||
    !!input.closest('form[role="search"]');

  if (isSearch && value.length > 0) {
    // Brief delay for autocomplete to settle, then submit
    await new Promise(r => setTimeout(r, 300));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    // Fallback: submit the form directly
    const form = input.closest('form');
    if (form) {
      try { form.requestSubmit(); } catch { form.submit(); }
    }
    return { ok: true, summary: `Typed '${value.slice(0, 30)}' and searched` };
  }

  return { ok: true, summary: `Typed '${value.slice(0, 30)}' into ${selector}` };
}

async function actionNavigate(url: string): Promise<ActionResult> {
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, summary: '', error: `Unsafe URL scheme — only http:// and https:// are allowed: ${url}` };
  }
  window.location.href = url;
  return { ok: true, summary: `Navigating to ${url}` };
}

async function actionExtract(selector: string): Promise<ActionResult> {
  let { el, error } = queryElement(selector);
  if (error) return { ok: false, summary: '', error };

  if (!el) {
    // Retry: scroll into view and re-query
    el = await scrollIntoViewAndRetry(selector);
    if (!el) return { ok: false, summary: '', error: `Element not found: ${selector}` };
  }

  const text = el.textContent?.trim() ?? '';
  return {
    ok: true,
    summary: `Extracted text from ${selector}: '${text.slice(0, 100)}'`,
    extractedText: text,
  };
}

async function actionScroll(selectorOrDirection: string): Promise<ActionResult> {
  const dir = selectorOrDirection.toLowerCase().trim();

  // Minimum delay after scroll to let the animation complete before DOM observation
  const SCROLL_SETTLE_MS = 600;

  // Handle direction-based scrolling
  if (dir === 'up') {
    window.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, SCROLL_SETTLE_MS));
    return { ok: true, summary: 'Scrolled up one screen' };
  }
  if (dir === 'down') {
    window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, SCROLL_SETTLE_MS));
    return { ok: true, summary: 'Scrolled down one screen' };
  }
  if (dir === 'top' || dir === 'page top' || dir === 'start') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, SCROLL_SETTLE_MS));
    return { ok: true, summary: 'Scrolled to top of page' };
  }
  if (dir === 'bottom' || dir === 'page bottom' || dir === 'end' || dir.includes('bottom')) {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, SCROLL_SETTLE_MS));
    return { ok: true, summary: 'Scrolled to bottom of page' };
  }

  // Try as CSS selector — scroll element into view
  let { el, error } = queryElement(selectorOrDirection);
  if (error) return { ok: false, summary: '', error };

  if (!el) {
    // Retry: scroll into view and re-query
    el = await scrollIntoViewAndRetry(selectorOrDirection);
    if (!el) return { ok: false, summary: '', error: `Element not found: ${selectorOrDirection}` };
  }

  (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
  return { ok: true, summary: `Scrolled to ${selectorOrDirection}` };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function executeAction(request: ActionRequest): Promise<ActionResult> {
  const { actionType, selector, value, url, direction } = request;

  // 1. Allowlist check
  if (!ALLOWED_ACTIONS.has(actionType)) {
    return { ok: false, summary: '', error: `Unknown action type: ${actionType}` };
  }

  // 2. Rate limiting
  await enforceRateLimit();

  // 3. Dispatch to implementation
  try {
    switch (actionType) {
      case 'click':
        if (!selector) return { ok: false, summary: '', error: 'selector is required for click' };
        return await actionClick(selector);

      case 'type':
        if (!selector) return { ok: false, summary: '', error: 'selector is required for type' };
        return await actionTypeText(selector, value ?? '');

      case 'navigate':
        if (!url) return { ok: false, summary: '', error: 'url is required for navigate' };
        return await actionNavigate(url);

      case 'extract':
        if (!selector) return { ok: false, summary: '', error: 'selector is required for extract' };
        return await actionExtract(selector);

      case 'scroll':
        return await actionScroll(direction ?? selector ?? 'down');

      default:
        return { ok: false, summary: '', error: `Unknown action type: ${actionType}` };
    }
  } catch (e) {
    return { ok: false, summary: '', error: (e as Error).message };
  }
}
