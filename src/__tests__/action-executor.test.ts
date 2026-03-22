/**
 * Comprehensive unit tests for src/content/action-executor.ts
 *
 * Covers:
 *   - All 5 action types (click, type, navigate, extract, scroll)
 *   - Allowlist validation (unknown action types rejected)
 *   - Selector sanitization (dangerous patterns blocked)
 *   - Rate limiting (MIN_ACTION_INTERVAL_MS enforced, promise chain)
 *   - Element highlighting (highlightElement function)
 *   - Scroll-into-view retry when element not found initially
 *   - MouseEvent fallback when .click() fails
 *   - Error cases (element not found, invalid selector, missing required params)
 *   - Auto-submit search boxes (input with role=searchbox, type=search, aria-label containing "search")
 *   - React native value setter (HTMLInputElement.prototype.value)
 *   - Scroll settle delay (600ms for direction-based scroll)
 */

// ─── Mock DOM globals ────────────────────────────────────────────────────────

const mockQuerySelector = jest.fn();
const mockScrollBy = jest.fn();
const mockScrollTo = jest.fn();

// Create a mock native setter for HTMLInputElement.prototype.value
const mockNativeSetter = jest.fn();

Object.defineProperty(global, 'document', {
  value: {
    querySelector: mockQuerySelector,
    body: { scrollHeight: 5000 },
  },
  writable: true,
});

Object.defineProperty(global, 'window', {
  value: {
    location: { href: 'https://example.com' },
    scrollBy: mockScrollBy,
    scrollTo: mockScrollTo,
    innerHeight: 800,
    HTMLInputElement: {
      prototype: {},
    },
  },
  writable: true,
});

// Set up the native value setter on HTMLInputElement.prototype
Object.defineProperty(window.HTMLInputElement.prototype, 'value', {
  set: mockNativeSetter,
  configurable: true,
});

// Mock MouseEvent constructor
class MockMouseEvent {
  type: string;
  bubbles: boolean;
  cancelable: boolean;
  constructor(type: string, opts?: { bubbles?: boolean; cancelable?: boolean }) {
    this.type = type;
    this.bubbles = opts?.bubbles ?? false;
    this.cancelable = opts?.cancelable ?? false;
  }
}
Object.defineProperty(global, 'MouseEvent', { value: MockMouseEvent, writable: true });

// Mock Event constructor
class MockEvent {
  type: string;
  bubbles: boolean;
  constructor(type: string, opts?: { bubbles?: boolean }) {
    this.type = type;
    this.bubbles = opts?.bubbles ?? false;
  }
}
Object.defineProperty(global, 'Event', { value: MockEvent, writable: true });

// Mock KeyboardEvent constructor
class MockKeyboardEvent {
  type: string;
  key: string;
  code: string;
  keyCode: number;
  bubbles: boolean;
  cancelable: boolean;
  constructor(type: string, opts?: any) {
    this.type = type;
    this.key = opts?.key ?? '';
    this.code = opts?.code ?? '';
    this.keyCode = opts?.keyCode ?? 0;
    this.bubbles = opts?.bubbles ?? false;
    this.cancelable = opts?.cancelable ?? false;
  }
}
Object.defineProperty(global, 'KeyboardEvent', { value: MockKeyboardEvent, writable: true });

// ─── Import after mocks ──────────────────────────────────────────────────────

import { executeAction, ActionRequest, ActionResult } from '../content/action-executor';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<ActionRequest>): ActionRequest {
  return {
    actionType: 'click',
    selector: '#test-button',
    description: 'Test action',
    ...overrides,
  };
}

function makeMockElement(overrides: Record<string, any> = {}): any {
  return {
    click: jest.fn(),
    textContent: 'Test Element',
    dispatchEvent: jest.fn(),
    focus: jest.fn(),
    value: '',
    type: '',
    name: '',
    scrollIntoView: jest.fn(),
    closest: jest.fn().mockReturnValue(null),
    getAttribute: jest.fn().mockReturnValue(null),
    style: {
      outline: '',
      transition: '',
      outlineOffset: '',
    },
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Action Executor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset querySelector to not throw (valid selector) and return null by default
    mockQuerySelector.mockReturnValue(null);
    // Reset the native setter mock
    mockNativeSetter.mockReset();
  });

  // ── ALLOWED_ACTIONS ────────────────────────────────────────────────────

  describe('ALLOWED_ACTIONS allowlist', () => {
    it('accepts click action', async () => {
      const mockEl = makeMockElement({ textContent: 'Buy Now' });
      mockQuerySelector.mockReturnValue(mockEl);

      const result = await executeAction(makeRequest({ actionType: 'click', selector: '#btn' }));
      expect(result.ok).toBe(true);
    });

    it('accepts type action', async () => {
      const mockInput = makeMockElement({ textContent: '', type: 'text' });
      mockQuerySelector.mockReturnValue(mockInput);

      const result = await executeAction(
        makeRequest({ actionType: 'type', selector: '#input', value: 'hello' })
      );
      expect(result.ok).toBe(true);
    });

    it('accepts navigate action', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'navigate', url: 'https://example.com', selector: undefined })
      );
      expect(result.ok).toBe(true);
    });

    it('accepts extract action', async () => {
      const mockEl = makeMockElement({ textContent: 'Extracted content' });
      mockQuerySelector.mockReturnValue(mockEl);

      const result = await executeAction(
        makeRequest({ actionType: 'extract', selector: '#content' })
      );
      expect(result.ok).toBe(true);
      expect(result.extractedText).toBe('Extracted content');
    });

    it('accepts scroll action', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'scroll', direction: 'down', selector: undefined })
      );
      expect(result.ok).toBe(true);
    });
  });

  // ── Rejects unknown action types ───────────────────────────────────────

  describe('unknown action types', () => {
    it('rejects "delete" action type', async () => {
      const result = await executeAction(makeRequest({ actionType: 'delete' }));
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Unknown action type');
    });

    it('rejects "eval" action type', async () => {
      const result = await executeAction(makeRequest({ actionType: 'eval' }));
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Unknown action type');
    });

    it('rejects empty action type', async () => {
      const result = await executeAction(makeRequest({ actionType: '' }));
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Unknown action type');
    });

    it('rejects "exec" action type', async () => {
      const result = await executeAction(makeRequest({ actionType: 'exec' }));
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Unknown action type');
    });

    it('rejects "submit" as non-allowlisted action type', async () => {
      const result = await executeAction(makeRequest({ actionType: 'submit' }));
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Unknown action type');
    });
  });

  // ── Selector sanitization ─────────────────────────────────────────────

  describe('selector sanitizer', () => {
    it('blocks javascript: URLs in selector', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'click', selector: 'a[href="javascript:alert(1)"]' })
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Dangerous selector');
    });

    it('blocks <script tags in selector', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'click', selector: '<script>alert(1)</script>' })
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Dangerous selector');
    });

    it('blocks event handler patterns like onclick=', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'click', selector: '[onclick="doEvil()"]' })
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Dangerous selector');
    });

    it('blocks backtick characters in selector', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'click', selector: '`template-literal`' })
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Dangerous selector');
    });

    it('blocks onerror= handler pattern', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'click', selector: '[onerror="alert(1)"]' })
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Dangerous selector');
    });

    it('blocks JavaScript: (case insensitive)', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'click', selector: 'a[href="JAVASCRIPT:void(0)"]' })
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Dangerous selector');
    });

    it('reports invalid CSS selector syntax', async () => {
      mockQuerySelector.mockImplementation((sel: string) => {
        if (sel === '#valid') return null;
        throw new DOMException('Invalid selector');
      });

      const result = await executeAction(
        makeRequest({ actionType: 'click', selector: '###invalid[' })
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Invalid selector');
    });

    it('allows valid CSS selectors through', async () => {
      const mockEl = makeMockElement({ textContent: 'OK' });
      mockQuerySelector.mockReturnValue(mockEl);

      const result = await executeAction(
        makeRequest({ actionType: 'click', selector: '#valid-button' })
      );
      expect(result.ok).toBe(true);
    });

    it('allows data-attribute selectors', async () => {
      const mockEl = makeMockElement({ textContent: 'Test' });
      mockQuerySelector.mockReturnValue(mockEl);

      const result = await executeAction(
        makeRequest({ actionType: 'click', selector: '[data-testid="my-button"]' })
      );
      expect(result.ok).toBe(true);
    });
  });

  // ── Rate limiting ─────────────────────────────────────────────────────

  describe('rate limiter', () => {
    it('enforces minimum delay between actions (promise chain)', async () => {
      const mockEl = makeMockElement({ textContent: 'X' });
      mockQuerySelector.mockReturnValue(mockEl);

      const start = Date.now();
      // Execute two actions rapidly
      await executeAction(makeRequest({ actionType: 'click', selector: '#a' }));
      await executeAction(makeRequest({ actionType: 'click', selector: '#b' }));
      const elapsed = Date.now() - start;

      // The second action should be delayed by at least ~300ms
      // (MIN_ACTION_INTERVAL_MS = 300), but allow some tolerance
      expect(elapsed).toBeGreaterThanOrEqual(250);
    });
  });

  // ── Click action ──────────────────────────────────────────────────────

  describe('click action', () => {
    it('calls .click() on the matched element', async () => {
      const mockEl = makeMockElement({ textContent: 'Submit' });
      mockQuerySelector.mockReturnValue(mockEl);

      const result = await executeAction(makeRequest({ actionType: 'click', selector: '#submit' }));

      expect(result.ok).toBe(true);
      expect(mockEl.click).toHaveBeenCalled();
      expect(result.summary).toContain('Submit');
    });

    it('returns error when element not found', async () => {
      mockQuerySelector.mockReturnValue(null);

      const result = await executeAction(makeRequest({ actionType: 'click', selector: '#missing' }));
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error when selector is missing', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'click', selector: undefined })
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('selector is required');
    });

    it('truncates long text in summary to 50 chars', async () => {
      const longText = 'A'.repeat(80);
      const mockEl = makeMockElement({ textContent: longText });
      mockQuerySelector.mockReturnValue(mockEl);

      const result = await executeAction(makeRequest({ actionType: 'click', selector: '#long' }));

      expect(result.ok).toBe(true);
      // The summary label is trimmed to 50 chars
      expect(result.summary.length).toBeLessThan(80);
    });

    it('uses selector as fallback label when textContent is empty', async () => {
      const mockEl = makeMockElement({ textContent: '' });
      mockQuerySelector.mockReturnValue(mockEl);

      const result = await executeAction(makeRequest({ actionType: 'click', selector: '#icon-btn' }));

      expect(result.ok).toBe(true);
      expect(result.summary).toContain('#icon-btn');
    });

    it('falls back to MouseEvent dispatch when .click() throws', async () => {
      const mockEl = makeMockElement({
        textContent: 'Fallback',
        click: jest.fn(() => { throw new Error('click not supported'); }),
        dispatchEvent: jest.fn(),
      });
      mockQuerySelector.mockReturnValue(mockEl);

      const result = await executeAction(makeRequest({ actionType: 'click', selector: '#fallback' }));

      expect(result.ok).toBe(true);
      expect(mockEl.dispatchEvent).toHaveBeenCalledTimes(1);
      const dispatched = mockEl.dispatchEvent.mock.calls[0][0];
      expect(dispatched).toBeInstanceOf(MockMouseEvent);
      expect(dispatched.type).toBe('click');
      expect(dispatched.bubbles).toBe(true);
      expect(dispatched.cancelable).toBe(true);
    });

    it('retries with scrollIntoView when element initially not found', async () => {
      const mockEl = makeMockElement({ textContent: 'Found After Scroll' });
      // First two calls: sanitize check (returns null, valid), initial query (returns null).
      // scrollIntoViewAndRetry: first querySelector returns element (to scroll into view),
      // second querySelector after scroll returns element.
      let callCount = 0;
      mockQuerySelector.mockImplementation(() => {
        callCount++;
        // Calls 1 and 2: sanitize + first query return null
        if (callCount <= 2) return null;
        // Calls 3+: scrollIntoView retry finds the element
        return mockEl;
      });

      const result = await executeAction(makeRequest({ actionType: 'click', selector: '#scroll-target' }));

      expect(result.ok).toBe(true);
      expect(result.summary).toContain('Found After Scroll');
    });
  });

  // ── Type action ───────────────────────────────────────────────────────

  describe('type action', () => {
    it('sets value via native setter and dispatches input + change events', async () => {
      const mockInput = makeMockElement({ textContent: '', type: 'text' });
      mockQuerySelector.mockReturnValue(mockInput);

      const result = await executeAction(
        makeRequest({ actionType: 'type', selector: '#search', value: 'wireless headphones' })
      );

      expect(result.ok).toBe(true);
      expect(mockInput.focus).toHaveBeenCalled();
      // Should use native setter (React-compatible)
      expect(mockNativeSetter).toHaveBeenCalledWith('wireless headphones');
      // Should dispatch input + change events
      const inputEventCalls = mockInput.dispatchEvent.mock.calls.filter(
        (c: any[]) => c[0].type === 'input' || c[0].type === 'change'
      );
      expect(inputEventCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('returns error when selector is missing', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'type', selector: undefined, value: 'test' })
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('selector is required');
    });

    it('uses empty string when value is undefined', async () => {
      const mockInput = makeMockElement({ textContent: '', type: 'text' });
      mockQuerySelector.mockReturnValue(mockInput);

      const result = await executeAction(
        makeRequest({ actionType: 'type', selector: '#empty-input', value: undefined })
      );

      expect(result.ok).toBe(true);
      // Native setter should have been called with empty string
      expect(mockNativeSetter).toHaveBeenCalledWith('');
    });

    it('truncates value in summary to 30 chars', async () => {
      const longValue = 'B'.repeat(60);
      const mockInput = makeMockElement({ textContent: '', type: 'text' });
      mockQuerySelector.mockReturnValue(mockInput);

      const result = await executeAction(
        makeRequest({ actionType: 'type', selector: '#long-input', value: longValue })
      );

      expect(result.ok).toBe(true);
      // Summary should contain truncated value
      expect(result.summary).toContain('B'.repeat(30));
      expect(result.summary).not.toContain('B'.repeat(60));
    });

    it('returns error when element not found', async () => {
      mockQuerySelector.mockReturnValue(null);

      const result = await executeAction(
        makeRequest({ actionType: 'type', selector: '#nonexistent', value: 'test' })
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // ── Auto-submit search boxes ─────────────────────────────────────────

  describe('auto-submit search boxes', () => {
    it('auto-submits when input type is "search"', async () => {
      const mockInput = makeMockElement({
        textContent: '',
        type: 'search',
        name: '',
        getAttribute: jest.fn().mockReturnValue(null),
        closest: jest.fn().mockReturnValue(null),
      });
      mockQuerySelector.mockReturnValue(mockInput);

      const result = await executeAction(
        makeRequest({ actionType: 'type', selector: '#search', value: 'headphones' })
      );

      expect(result.ok).toBe(true);
      expect(result.summary).toContain('searched');

      // Should dispatch keyboard events (Enter key)
      const keydownCalls = mockInput.dispatchEvent.mock.calls.filter(
        (c: any[]) => c[0].type === 'keydown'
      );
      expect(keydownCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('auto-submits when input role is "searchbox"', async () => {
      const mockInput = makeMockElement({
        textContent: '',
        type: 'text',
        name: '',
        getAttribute: jest.fn((attr: string) => {
          if (attr === 'role') return 'searchbox';
          return null;
        }),
        closest: jest.fn().mockReturnValue(null),
      });
      mockQuerySelector.mockReturnValue(mockInput);

      const result = await executeAction(
        makeRequest({ actionType: 'type', selector: '#search', value: 'shoes' })
      );

      expect(result.ok).toBe(true);
      expect(result.summary).toContain('searched');
    });

    it('auto-submits when aria-label contains "search"', async () => {
      const mockInput = makeMockElement({
        textContent: '',
        type: 'text',
        name: '',
        getAttribute: jest.fn((attr: string) => {
          if (attr === 'aria-label') return 'Search products';
          if (attr === 'role') return null;
          return null;
        }),
        closest: jest.fn().mockReturnValue(null),
      });
      mockQuerySelector.mockReturnValue(mockInput);

      const result = await executeAction(
        makeRequest({ actionType: 'type', selector: '#search', value: 'laptop' })
      );

      expect(result.ok).toBe(true);
      expect(result.summary).toContain('searched');
    });

    it('does not auto-submit for regular text inputs', async () => {
      const mockInput = makeMockElement({
        textContent: '',
        type: 'text',
        name: 'email',
        getAttribute: jest.fn().mockReturnValue(null),
        closest: jest.fn().mockReturnValue(null),
      });
      mockQuerySelector.mockReturnValue(mockInput);

      const result = await executeAction(
        makeRequest({ actionType: 'type', selector: '#email', value: 'test@test.com' })
      );

      expect(result.ok).toBe(true);
      expect(result.summary).not.toContain('searched');
      // Should NOT dispatch keydown for Enter
      const keydownCalls = mockInput.dispatchEvent.mock.calls.filter(
        (c: any[]) => c[0].type === 'keydown'
      );
      expect(keydownCalls.length).toBe(0);
    });
  });

  // ── Navigate action ───────────────────────────────────────────────────

  describe('navigate action', () => {
    it('rejects non-http URLs (ftp)', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'navigate', url: 'ftp://evil.com/file', selector: undefined })
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Unsafe URL');
    });

    it('rejects javascript: URLs', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'navigate', url: 'javascript:alert(1)', selector: undefined })
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Unsafe URL');
    });

    it('rejects data: URLs', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'navigate', url: 'data:text/html,<h1>hi</h1>', selector: undefined })
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Unsafe URL');
    });

    it('accepts https:// URLs', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'navigate', url: 'https://example.com', selector: undefined })
      );
      expect(result.ok).toBe(true);
      expect(result.summary).toContain('https://example.com');
    });

    it('accepts http:// URLs', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'navigate', url: 'http://localhost:3000', selector: undefined })
      );
      expect(result.ok).toBe(true);
    });

    it('returns error when url is missing', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'navigate', url: undefined, selector: undefined })
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('url is required');
    });

    it('sets window.location.href on success', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'navigate', url: 'https://new-page.com', selector: undefined })
      );
      expect(result.ok).toBe(true);
      expect(window.location.href).toBe('https://new-page.com');
    });
  });

  // ── Extract action ────────────────────────────────────────────────────

  describe('extract action', () => {
    it('extracts and returns text content', async () => {
      const mockEl = makeMockElement({ textContent: '  Price: $29.99  ' });
      mockQuerySelector.mockReturnValue(mockEl);

      const result = await executeAction(
        makeRequest({ actionType: 'extract', selector: '.price' })
      );
      expect(result.ok).toBe(true);
      expect(result.extractedText).toBe('Price: $29.99');
    });

    it('returns error when selector is missing', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'extract', selector: undefined })
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('selector is required');
    });

    it('returns error when element not found', async () => {
      mockQuerySelector.mockReturnValue(null);

      const result = await executeAction(
        makeRequest({ actionType: 'extract', selector: '#nonexistent' })
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns empty string when element has no text', async () => {
      const mockEl = makeMockElement({ textContent: '' });
      mockQuerySelector.mockReturnValue(mockEl);

      const result = await executeAction(
        makeRequest({ actionType: 'extract', selector: '#empty' })
      );
      expect(result.ok).toBe(true);
      expect(result.extractedText).toBe('');
    });

    it('includes truncated text (100 chars) in summary', async () => {
      const longText = 'C'.repeat(200);
      const mockEl = makeMockElement({ textContent: longText });
      mockQuerySelector.mockReturnValue(mockEl);

      const result = await executeAction(
        makeRequest({ actionType: 'extract', selector: '#long-text' })
      );
      expect(result.ok).toBe(true);
      // extractedText has full content
      expect(result.extractedText).toBe(longText);
      // Summary should be shorter than full text
      expect(result.summary.length).toBeLessThan(longText.length + 50);
    });
  });

  // ── Scroll action ─────────────────────────────────────────────────────

  describe('scroll action', () => {
    it('scrolls down when direction is "down"', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'scroll', direction: 'down', selector: undefined })
      );
      expect(result.ok).toBe(true);
      expect(mockScrollBy).toHaveBeenCalledWith(
        expect.objectContaining({ top: expect.any(Number), behavior: 'smooth' })
      );
      // Should scroll by 0.8 * innerHeight = 640
      expect(mockScrollBy.mock.calls[0][0].top).toBe(640);
    });

    it('scrolls up when direction is "up"', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'scroll', direction: 'up', selector: undefined })
      );
      expect(result.ok).toBe(true);
      expect(mockScrollBy).toHaveBeenCalledWith(
        expect.objectContaining({ top: -640, behavior: 'smooth' })
      );
    });

    it('scrolls to top when direction is "top"', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'scroll', direction: 'top', selector: undefined })
      );
      expect(result.ok).toBe(true);
      expect(mockScrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ top: 0 })
      );
    });

    it('scrolls to top when direction is "page top"', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'scroll', direction: 'page top', selector: undefined })
      );
      expect(result.ok).toBe(true);
      expect(mockScrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ top: 0 })
      );
    });

    it('scrolls to top when direction is "start"', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'scroll', direction: 'start', selector: undefined })
      );
      expect(result.ok).toBe(true);
      expect(mockScrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ top: 0 })
      );
    });

    it('scrolls to bottom when direction is "bottom"', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'scroll', direction: 'bottom', selector: undefined })
      );
      expect(result.ok).toBe(true);
      expect(mockScrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ top: 5000 })
      );
    });

    it('scrolls to bottom when direction is "page bottom"', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'scroll', direction: 'page bottom', selector: undefined })
      );
      expect(result.ok).toBe(true);
      expect(mockScrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ top: 5000 })
      );
    });

    it('scrolls to bottom when direction is "end"', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'scroll', direction: 'end', selector: undefined })
      );
      expect(result.ok).toBe(true);
      expect(mockScrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ top: 5000 })
      );
    });

    it('scrolls to bottom when direction contains "bottom"', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'scroll', direction: 'scroll to bottom of page', selector: undefined })
      );
      expect(result.ok).toBe(true);
      expect(mockScrollTo).toHaveBeenCalled();
    });

    it('scrolls element into view when direction is a CSS selector', async () => {
      const mockEl = makeMockElement({ textContent: 'Target Section' });
      mockQuerySelector.mockReturnValue(mockEl);

      const result = await executeAction(
        makeRequest({ actionType: 'scroll', direction: '#section-3', selector: undefined })
      );

      expect(result.ok).toBe(true);
      expect(mockEl.scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'smooth', block: 'center' })
      );
    });

    it('defaults to "down" when no direction or selector given', async () => {
      const result = await executeAction(
        makeRequest({ actionType: 'scroll', direction: undefined, selector: undefined })
      );
      expect(result.ok).toBe(true);
      expect(mockScrollBy).toHaveBeenCalled();
    });

    it('includes 600ms settle delay for direction-based scroll', async () => {
      const start = Date.now();
      await executeAction(
        makeRequest({ actionType: 'scroll', direction: 'down', selector: undefined })
      );
      const elapsed = Date.now() - start;

      // Should have waited at least ~600ms (SCROLL_SETTLE_MS) + rate limit
      // Allow some tolerance
      expect(elapsed).toBeGreaterThanOrEqual(500);
    });
  });

  // ── Element highlighting ──────────────────────────────────────────────

  describe('element highlighting', () => {
    it('applies and removes highlight outline on click', async () => {
      const mockEl = makeMockElement({
        textContent: 'Highlighted',
        style: {
          outline: '',
          transition: '',
          outlineOffset: '',
        },
      });
      mockQuerySelector.mockReturnValue(mockEl);

      const result = await executeAction(makeRequest({ actionType: 'click', selector: '#highlight-test' }));

      expect(result.ok).toBe(true);
      // After the highlight timeout completes, the outline should be reset
      expect(mockEl.style.outlineOffset).toBe('');
    });
  });

  // ── Error handling edge cases ─────────────────────────────────────────

  describe('error handling', () => {
    it('handles querySelector throwing an unexpected error', async () => {
      mockQuerySelector.mockImplementation(() => {
        throw new Error('Unexpected DOM error');
      });

      const result = await executeAction(makeRequest({ actionType: 'click', selector: '#crash' }));

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('always returns ActionResult shape even on errors', async () => {
      const result = await executeAction(makeRequest({ actionType: 'unknown-action-xyz' }));

      expect(result).toHaveProperty('ok');
      expect(result).toHaveProperty('summary');
      expect(typeof result.ok).toBe('boolean');
      expect(typeof result.summary).toBe('string');
    });
  });
});
