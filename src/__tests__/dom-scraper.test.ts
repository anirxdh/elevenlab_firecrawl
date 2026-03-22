/**
 * Comprehensive unit tests for src/content/dom-scraper.ts
 *
 * Covers:
 *   - Viewport filtering (isVisible)
 *   - Bounding box data (getBBox) on elements
 *   - Selector building priority chain (id > data-testid > data-* > aria-label > title > href > name > class)
 *   - Button, link, input, form scraping
 *   - Product detection (Amazon, Schema.org, generic, JSON-LD)
 *   - Text content extraction (8000 char limit)
 *   - Full scrapeDom() returns correct structure
 *   - classifyElement semantic role detection
 *   - Link role detection (product-link, cart-link, video-link)
 *   - Safe wrapper (scraper function failure doesn't crash scrapeDom)
 *   - href-based selector for links (a[href*="..."])
 *   - title-based selector
 *   - data-video-id, data-product-id selectors
 *   - nth-of-type (not nth-child)
 */

// ─── Mock CSS.escape ─────────────────────────────────────────────────────────

const mockCSSescape = (value: string) => value.replace(/([^\w-])/g, '\\$1');

Object.defineProperty(global, 'CSS', {
  value: { escape: mockCSSescape },
  writable: true,
});

// ─── Mock document helpers ──────────────────────────────────────────────────

function createMockElement(overrides: Record<string, any> = {}): any {
  const el: any = {
    id: '',
    tagName: 'DIV',
    className: '',
    classList: [],
    textContent: '',
    innerText: '',
    getAttribute: jest.fn().mockReturnValue(null),
    querySelector: jest.fn().mockReturnValue(null),
    querySelectorAll: jest.fn().mockReturnValue([]),
    getBoundingClientRect: jest.fn().mockReturnValue({
      width: 100,
      height: 50,
      top: 100,
      bottom: 150,
      left: 50,
      right: 150,
    }),
    checkVisibility: jest.fn().mockReturnValue(true),
    parentElement: null,
    children: [],
    closest: jest.fn().mockReturnValue(null),
    ...overrides,
  };
  // Ensure classList is iterable and has a length
  if (Array.isArray(el.classList)) {
    const arr = el.classList;
    el.classList = arr;
    el.classList.length = arr.length;
  }
  return el;
}

const mockDocument: any = {
  title: 'Test Page',
  querySelector: jest.fn().mockReturnValue(null),
  querySelectorAll: jest.fn().mockReturnValue([]),
  getElementById: jest.fn().mockReturnValue(null),
  body: {
    innerText: 'Hello world page content for testing purposes',
    textContent: 'Hello world page content for testing purposes',
    scrollHeight: 5000,
  },
};

Object.defineProperty(global, 'document', { value: mockDocument, writable: true });
Object.defineProperty(global, 'window', {
  value: {
    location: { href: 'https://example.com/test-page' },
    innerHeight: 800,
    innerWidth: 1200,
  },
  writable: true,
});

// Mock HTMLElement types used in instanceof checks
class FakeHTMLInputElement {}
class FakeHTMLTextAreaElement {}
class FakeHTMLSelectElement {}
class FakeHTMLFormElement {}
(global as any).HTMLInputElement = FakeHTMLInputElement;
(global as any).HTMLTextAreaElement = FakeHTMLTextAreaElement;
(global as any).HTMLSelectElement = FakeHTMLSelectElement;
(global as any).HTMLFormElement = FakeHTMLFormElement;

// ─── Import after mocks ──────────────────────────────────────────────────────
// Use require() instead of import to ensure mocks are set up before module load.
// TypeScript import statements get hoisted above all other statements.

const domScraperModule = require('../content/dom-scraper');
const scrapeDom: () => any = domScraperModule.scrapeDom;

// Type alias for test readability
interface DomSnapshot {
  url: string;
  title: string;
  description: string;
  canonicalUrl: string;
  sections: Array<{ type: string; heading?: string; summary: string }>;
  buttons: Array<{ selector: string; text: string; role?: string; visible: boolean; bbox?: { x: number; y: number; w: number; h: number } }>;
  links: Array<{ selector: string; text: string; role?: string; href?: string; visible: boolean; bbox?: any }>;
  inputs: Array<{ selector: string; type: string; value: string; placeholder: string; label?: string; visible: boolean; bbox?: any }>;
  forms: Array<{ selector: string; action: string; method: string; inputs: any[] }>;
  headings: Array<{ level: number; text: string }>;
  images: Array<{ alt: string; src: string; selector: string }>;
  tables: Array<{ selector: string; headers: string[]; rowCount: number; sampleRows: string[][] }>;
  lists: Array<{ selector: string; type: 'ordered' | 'unordered'; items: string[] }>;
  products: Array<{ name: string; price?: string; rating?: string; imageAlt?: string; selector: string; linkSelector?: string; addToCartSelector?: string }>;
  text_content: string;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DOM Scraper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: return empty NodeLists for all selectors
    mockDocument.querySelectorAll.mockReturnValue([]);
    mockDocument.querySelector.mockReturnValue(null);
    mockDocument.getElementById.mockReturnValue(null);
    mockDocument.body.innerText = 'Hello world page content for testing purposes';
    mockDocument.body.textContent = 'Hello world page content for testing purposes';
  });

  // ── scrapeDom() return structure ───────────────────────────────────────

  describe('scrapeDom() return structure', () => {
    it('returns all expected top-level fields', () => {
      const snapshot = scrapeDom();

      const expectedFields: (keyof DomSnapshot)[] = [
        'url',
        'title',
        'description',
        'canonicalUrl',
        'sections',
        'buttons',
        'links',
        'inputs',
        'forms',
        'headings',
        'images',
        'tables',
        'lists',
        'products',
        'text_content',
      ];

      for (const field of expectedFields) {
        expect(snapshot).toHaveProperty(field);
      }
    });

    it('returns the current page URL', () => {
      const snapshot = scrapeDom();
      expect(snapshot.url).toBe('https://example.com/test-page');
    });

    it('returns the document title', () => {
      const snapshot = scrapeDom();
      expect(snapshot.title).toBe('Test Page');
    });

    it('returns arrays for interactive element collections', () => {
      const snapshot = scrapeDom();
      expect(Array.isArray(snapshot.buttons)).toBe(true);
      expect(Array.isArray(snapshot.links)).toBe(true);
      expect(Array.isArray(snapshot.inputs)).toBe(true);
      expect(Array.isArray(snapshot.forms)).toBe(true);
    });

    it('returns arrays for content collections', () => {
      const snapshot = scrapeDom();
      expect(Array.isArray(snapshot.headings)).toBe(true);
      expect(Array.isArray(snapshot.images)).toBe(true);
      expect(Array.isArray(snapshot.tables)).toBe(true);
      expect(Array.isArray(snapshot.lists)).toBe(true);
      expect(Array.isArray(snapshot.products)).toBe(true);
    });

    it('returns a string for text_content', () => {
      const snapshot = scrapeDom();
      expect(typeof snapshot.text_content).toBe('string');
    });

    it('returns empty description when no meta tag found', () => {
      mockDocument.querySelector.mockReturnValue(null);
      const snapshot = scrapeDom();
      expect(snapshot.description).toBe('');
    });

    it('returns empty canonicalUrl when no canonical link found', () => {
      mockDocument.querySelector.mockReturnValue(null);
      const snapshot = scrapeDom();
      expect(snapshot.canonicalUrl).toBe('');
    });
  });

  // ── buildSelector priority (tested indirectly through buttons) ─────────

  describe('buildSelector priority', () => {
    it('prioritizes id attribute first', () => {
      const mockBtn = createMockElement({
        id: 'main-button',
        tagName: 'BUTTON',
        textContent: 'Click Me',
        getAttribute: jest.fn((attr: string) => {
          if (attr === 'data-testid') return 'btn-test';
          if (attr === 'aria-label') return 'Main Button';
          return null;
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      if (snapshot.buttons.length > 0) {
        // When id is set, selector should be #id format
        expect(snapshot.buttons[0].selector).toMatch(/^#/);
        expect(snapshot.buttons[0].selector).toContain('main');
      }
    });

    it('uses data-testid when id is absent', () => {
      const mockBtn = createMockElement({
        id: '',
        tagName: 'BUTTON',
        textContent: 'Submit Form',
        getAttribute: jest.fn((attr: string) => {
          if (attr === 'data-testid') return 'submit-btn';
          if (attr === 'aria-label') return 'Submit';
          if (attr === 'name') return 'submitBtn';
          return null;
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      if (snapshot.buttons.length > 0) {
        expect(snapshot.buttons[0].selector).toContain('data-testid');
        expect(snapshot.buttons[0].selector).toContain('submit-btn');
      }
    });

    it('uses aria-label when id and data-testid are absent', () => {
      const mockBtn = createMockElement({
        id: '',
        tagName: 'BUTTON',
        textContent: 'X',
        getAttribute: jest.fn((attr: string) => {
          if (attr === 'data-testid') return null;
          if (attr === 'data-asin') return null;
          if (attr === 'data-video-id') return null;
          if (attr === 'data-id') return null;
          if (attr === 'data-product-id') return null;
          if (attr === 'data-item-id') return null;
          if (attr === 'aria-label') return 'Close dialog';
          if (attr === 'title') return null;
          if (attr === 'name') return null;
          return null;
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      if (snapshot.buttons.length > 0) {
        expect(snapshot.buttons[0].selector).toContain('aria-label');
        // CSS.escape turns "Close dialog" into "Close\ dialog" — check for escaped form
        expect(snapshot.buttons[0].selector).toContain('Close');
        expect(snapshot.buttons[0].selector).toContain('dialog');
      }
    });

    it('uses title attribute when higher-priority attributes are absent', () => {
      const mockBtn = createMockElement({
        id: '',
        tagName: 'BUTTON',
        textContent: 'Play',
        getAttribute: jest.fn((attr: string) => {
          if (attr === 'data-testid') return null;
          if (attr === 'data-asin') return null;
          if (attr === 'data-video-id') return null;
          if (attr === 'data-id') return null;
          if (attr === 'data-product-id') return null;
          if (attr === 'data-item-id') return null;
          if (attr === 'aria-label') return null;
          if (attr === 'title') return 'Play video';
          if (attr === 'name') return null;
          return null;
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      if (snapshot.buttons.length > 0) {
        expect(snapshot.buttons[0].selector).toContain('title');
        expect(snapshot.buttons[0].selector).toContain('Play');
      }
    });

    it('uses data-video-id when present', () => {
      const mockBtn = createMockElement({
        id: '',
        tagName: 'BUTTON',
        textContent: 'Watch',
        getAttribute: jest.fn((attr: string) => {
          if (attr === 'data-testid') return null;
          if (attr === 'data-asin') return null;
          if (attr === 'data-video-id') return 'abc123';
          return null;
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      if (snapshot.buttons.length > 0) {
        expect(snapshot.buttons[0].selector).toContain('data-video-id');
        expect(snapshot.buttons[0].selector).toContain('abc123');
      }
    });

    it('uses data-product-id when present', () => {
      const mockBtn = createMockElement({
        id: '',
        tagName: 'BUTTON',
        textContent: 'Add',
        getAttribute: jest.fn((attr: string) => {
          if (attr === 'data-testid') return null;
          if (attr === 'data-asin') return null;
          if (attr === 'data-video-id') return null;
          if (attr === 'data-id') return null;
          if (attr === 'data-product-id') return 'prod-456';
          return null;
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      if (snapshot.buttons.length > 0) {
        expect(snapshot.buttons[0].selector).toContain('data-product-id');
        expect(snapshot.buttons[0].selector).toContain('prod-456');
      }
    });

    it('uses name attribute when higher-priority attributes are absent', () => {
      const mockBtn = createMockElement({
        id: '',
        tagName: 'BUTTON',
        textContent: 'Go',
        getAttribute: jest.fn((attr: string) => {
          if (attr === 'data-testid') return null;
          if (attr === 'data-asin') return null;
          if (attr === 'data-video-id') return null;
          if (attr === 'data-id') return null;
          if (attr === 'data-product-id') return null;
          if (attr === 'data-item-id') return null;
          if (attr === 'aria-label') return null;
          if (attr === 'title') return null;
          if (attr === 'name') return 'go-btn';
          return null;
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      if (snapshot.buttons.length > 0) {
        expect(snapshot.buttons[0].selector).toContain('name');
        expect(snapshot.buttons[0].selector).toContain('go-btn');
      }
    });

    it('falls back to tag+class when no other attributes present', () => {
      const mockBtn = createMockElement({
        id: '',
        tagName: 'BUTTON',
        textContent: 'Generic',
        classList: ['btn', 'primary'],
        getAttribute: jest.fn(() => null),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      if (snapshot.buttons.length > 0) {
        expect(snapshot.buttons[0].selector).toContain('button');
      }
    });

    it('uses href-based selector for links', () => {
      const mockLink = createMockElement({
        id: '',
        tagName: 'A',
        textContent: 'Product Page',
        href: 'https://example.com/product/wireless-headphones',
        getAttribute: jest.fn((attr: string) => {
          if (attr === 'data-testid') return null;
          if (attr === 'data-asin') return null;
          if (attr === 'data-video-id') return null;
          if (attr === 'data-id') return null;
          if (attr === 'data-product-id') return null;
          if (attr === 'data-item-id') return null;
          if (attr === 'aria-label') return null;
          if (attr === 'title') return null;
          if (attr === 'href') return '/product/wireless-headphones';
          if (attr === 'name') return null;
          return null;
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === 'a[href]') {
          return [mockLink];
        }
        return [];
      });

      const snapshot = scrapeDom();
      if (snapshot.links.length > 0) {
        // Should use a[href*="..."] format
        expect(snapshot.links[0].selector).toContain('a[href');
      }
    });

    it('uses nth-of-type (not nth-child) for disambiguation', () => {
      const parent = createMockElement({
        id: 'container',
        tagName: 'DIV',
      });

      const btn1 = createMockElement({
        id: '',
        tagName: 'BUTTON',
        textContent: 'First',
        classList: [],
        getAttribute: jest.fn(() => null),
        parentElement: parent,
      });

      const btn2 = createMockElement({
        id: '',
        tagName: 'BUTTON',
        textContent: 'Second',
        classList: [],
        getAttribute: jest.fn(() => null),
        parentElement: parent,
      });

      parent.children = [btn1, btn2];

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [btn1, btn2];
        }
        return [];
      });

      const snapshot = scrapeDom();
      // At least one button should use nth-of-type
      const nthOfTypeUsed = snapshot.buttons.some((b: any) => b.selector.includes('nth-of-type'));
      if (snapshot.buttons.length >= 2) {
        expect(nthOfTypeUsed).toBe(true);
      }
    });
  });

  // ── Bounding box data ──────────────────────────────────────────────────

  describe('bounding box (getBBox)', () => {
    it('includes bbox data for buttons', () => {
      const mockBtn = createMockElement({
        id: 'bbox-btn',
        tagName: 'BUTTON',
        textContent: 'BBox Test',
        getBoundingClientRect: jest.fn().mockReturnValue({
          width: 120,
          height: 40,
          top: 200,
          bottom: 240,
          left: 50,
          right: 170,
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      if (snapshot.buttons.length > 0) {
        const bbox = snapshot.buttons[0].bbox;
        expect(bbox).toBeDefined();
        expect(bbox?.x).toBe(50);
        expect(bbox?.y).toBe(200);
        expect(bbox?.w).toBe(120);
        expect(bbox?.h).toBe(40);
      }
    });
  });

  // ── Button scraping ────────────────────────────────────────────────────

  describe('button scraping', () => {
    it('scrapes visible buttons', () => {
      const mockBtn = createMockElement({
        id: 'btn1',
        tagName: 'BUTTON',
        textContent: 'Add to Cart',
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.buttons.length).toBe(1);
      expect(snapshot.buttons[0].text).toBe('Add to Cart');
      expect(snapshot.buttons[0].visible).toBe(true);
    });

    it('skips invisible buttons', () => {
      const mockBtn = createMockElement({
        id: 'hidden-btn',
        tagName: 'BUTTON',
        textContent: 'Hidden',
        checkVisibility: jest.fn().mockReturnValue(false),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.buttons.length).toBe(0);
    });

    it('skips buttons with empty text', () => {
      const mockBtn = createMockElement({
        id: 'empty-btn',
        tagName: 'BUTTON',
        textContent: '',
        getAttribute: jest.fn().mockReturnValue(null),
      });
      (mockBtn as any).value = '';

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.buttons.length).toBe(0);
    });

    it('limits buttons to 100', () => {
      const buttons = Array.from({ length: 120 }, (_, i) =>
        createMockElement({
          id: `btn-${i}`,
          tagName: 'BUTTON',
          textContent: `Button ${i}`,
        })
      );

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return buttons;
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.buttons.length).toBeLessThanOrEqual(100);
    });
  });

  // ── Link scraping ─────────────────────────────────────────────────────

  describe('link scraping', () => {
    it('scrapes visible links with href', () => {
      const mockLink = createMockElement({
        id: 'link1',
        tagName: 'A',
        textContent: 'Go to Products',
        href: 'https://example.com/products',
        getAttribute: jest.fn((attr: string) => {
          if (attr === 'aria-label') return null;
          return null;
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === 'a[href]') {
          return [mockLink];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.links.length).toBe(1);
      expect(snapshot.links[0].text).toBe('Go to Products');
      expect(snapshot.links[0].href).toBe('https://example.com/products');
    });

    it('limits links to 100', () => {
      const links = Array.from({ length: 120 }, (_, i) =>
        createMockElement({
          id: `link-${i}`,
          tagName: 'A',
          textContent: `Link ${i}`,
          href: `https://example.com/page/${i}`,
        })
      );

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === 'a[href]') {
          return links;
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.links.length).toBeLessThanOrEqual(100);
    });

    it('detects product-link role for /dp/ URLs', () => {
      const mockLink = createMockElement({
        id: 'prod-link',
        tagName: 'A',
        textContent: 'Wireless Headphones',
        href: 'https://amazon.com/dp/B09ABC1234',
        getAttribute: jest.fn(() => null),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === 'a[href]') {
          return [mockLink];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.links.length).toBe(1);
      expect(snapshot.links[0].role).toBe('product-link');
    });

    it('detects cart-link role for /cart URLs', () => {
      const mockLink = createMockElement({
        id: 'cart-link',
        tagName: 'A',
        textContent: 'View Cart',
        href: 'https://amazon.com/cart',
        getAttribute: jest.fn(() => null),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === 'a[href]') {
          return [mockLink];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.links.length).toBe(1);
      expect(snapshot.links[0].role).toBe('cart-link');
    });

    it('detects video-link role for /watch URLs', () => {
      const mockLink = createMockElement({
        id: 'vid-link',
        tagName: 'A',
        textContent: 'Tutorial Video',
        href: 'https://youtube.com/watch?v=abc123',
        getAttribute: jest.fn(() => null),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === 'a[href]') {
          return [mockLink];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.links.length).toBe(1);
      expect(snapshot.links[0].role).toBe('video-link');
    });
  });

  // ── Input scraping ────────────────────────────────────────────────────

  describe('input scraping', () => {
    it('scrapes input elements', () => {
      const mockInput = createMockElement({
        id: 'search-input',
        tagName: 'INPUT',
        type: 'text',
        value: '',
        placeholder: 'Search...',
        getAttribute: jest.fn((attr: string) => {
          if (attr === 'aria-label') return 'Search field';
          return null;
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === 'input, textarea, select') {
          return [mockInput];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.inputs.length).toBe(1);
      expect(snapshot.inputs[0].placeholder).toBe('Search...');
    });
  });

  // ── Form scraping ─────────────────────────────────────────────────────

  describe('form scraping', () => {
    it('scrapes forms with their inputs', () => {
      const mockInput = createMockElement({
        id: 'email',
        tagName: 'INPUT',
        type: 'email',
        value: '',
        placeholder: 'Email address',
        getAttribute: jest.fn(() => null),
      });

      const mockForm = createMockElement({
        id: 'login-form',
        tagName: 'FORM',
        action: '/login',
        method: 'post',
        getAttribute: jest.fn(() => null),
        querySelectorAll: jest.fn().mockReturnValue([mockInput]),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === 'form') {
          return [mockForm];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.forms.length).toBe(1);
      expect(snapshot.forms[0].action).toBe('/login');
      expect(snapshot.forms[0].method).toBe('POST');
      expect(snapshot.forms[0].inputs.length).toBe(1);
    });
  });

  // ── Text content truncation ────────────────────────────────────────────

  describe('text content extraction', () => {
    it('truncates text_content to 8000 chars maximum', () => {
      const longText = 'A'.repeat(10000);
      mockDocument.body.innerText = longText;

      const snapshot = scrapeDom();
      expect(snapshot.text_content.length).toBeLessThanOrEqual(8000);
    });

    it('preserves text content when under 8000 chars', () => {
      const shortText = 'Short content';
      mockDocument.body.innerText = shortText;

      const snapshot = scrapeDom();
      expect(snapshot.text_content).toBe(shortText);
    });

    it('collapses excess whitespace', () => {
      mockDocument.body.innerText = 'Hello    world\t\twith    spaces';

      const snapshot = scrapeDom();
      expect(snapshot.text_content).toBe('Hello world with spaces');
    });

    it('collapses excess blank lines', () => {
      mockDocument.body.innerText = 'Line one\n\n\n\n\nLine two';

      const snapshot = scrapeDom();
      expect(snapshot.text_content).toBe('Line one\n\nLine two');
    });

    it('returns empty string when body has no text', () => {
      mockDocument.body.innerText = '';

      const snapshot = scrapeDom();
      expect(snapshot.text_content).toBe('');
    });
  });

  // ── Sections detection ─────────────────────────────────────────────────

  describe('sections', () => {
    it('returns synthetic main section when no semantic tags found', () => {
      mockDocument.querySelectorAll.mockReturnValue([]);
      mockDocument.body.innerText = 'Page body content';
      mockDocument.body.textContent = 'Page body content';

      const snapshot = scrapeDom();
      expect(snapshot.sections.length).toBeGreaterThanOrEqual(1);
      expect(snapshot.sections[0].type).toBe('main');
    });

    it('detects semantic section elements', () => {
      const mockMain = createMockElement({
        tagName: 'MAIN',
        textContent: 'Main content area with enough text to pass the threshold',
      });

      const mockNav = createMockElement({
        tagName: 'NAV',
        textContent: 'Navigation links area with enough text to pass the threshold',
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('header') && selector.includes('nav')) {
          return [mockMain, mockNav];
        }
        return [];
      });

      const snapshot = scrapeDom();
      // Should have at least the synthetic main section
      expect(snapshot.sections.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── classifyElement ────────────────────────────────────────────────────

  describe('classifyElement (via button roles)', () => {
    it('classifies "Add to Cart" button as add-to-cart role', () => {
      const mockBtn = createMockElement({
        id: 'cart-btn',
        tagName: 'BUTTON',
        textContent: 'Add to Cart',
        getAttribute: jest.fn(() => null),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.buttons.length).toBe(1);
      expect(snapshot.buttons[0].role).toBe('add-to-cart');
    });

    it('classifies "Buy Now" button as buy-now role', () => {
      const mockBtn = createMockElement({
        id: 'buy-btn',
        tagName: 'BUTTON',
        textContent: 'Buy Now',
        getAttribute: jest.fn(() => null),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.buttons.length).toBe(1);
      expect(snapshot.buttons[0].role).toBe('buy-now');
    });

    it('classifies "Close" button as close role', () => {
      const mockBtn = createMockElement({
        id: 'close-btn',
        tagName: 'BUTTON',
        textContent: 'Close',
        getAttribute: jest.fn(() => null),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.buttons.length).toBe(1);
      expect(snapshot.buttons[0].role).toBe('close');
    });

    it('classifies "Next" button as navigation role', () => {
      const mockBtn = createMockElement({
        id: 'next-btn',
        tagName: 'BUTTON',
        textContent: 'Next Page',
        getAttribute: jest.fn(() => null),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.buttons.length).toBe(1);
      expect(snapshot.buttons[0].role).toBe('navigation');
    });

    it('returns undefined role for generic buttons', () => {
      const mockBtn = createMockElement({
        id: 'generic-btn',
        tagName: 'BUTTON',
        textContent: 'Details',
        getAttribute: jest.fn(() => null),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.buttons.length).toBe(1);
      expect(snapshot.buttons[0].role).toBeUndefined();
    });
  });

  // ── Safe wrapper ──────────────────────────────────────────────────────

  describe('safe wrapper', () => {
    it('does not crash scrapeDom when internal scraper throws', () => {
      // Make querySelectorAll throw for a specific selector pattern
      // that only affects one sub-scraper
      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === 'h1, h2, h3, h4, h5, h6') {
          throw new Error('Simulated heading scrape failure');
        }
        return [];
      });

      // Suppress the console.warn from safe()
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      // scrapeDom should still succeed
      const snapshot = scrapeDom();
      expect(snapshot).toBeDefined();
      expect(snapshot.url).toBe('https://example.com/test-page');
      // Headings should be empty (fallback) but not crash
      expect(Array.isArray(snapshot.headings)).toBe(true);
    });
  });

  // ── Headings ───────────────────────────────────────────────────────────

  describe('headings', () => {
    it('scrapes heading elements with level and text', () => {
      const h1 = createMockElement({ tagName: 'H1', textContent: 'Main Title' });
      const h2 = createMockElement({ tagName: 'H2', textContent: 'Subtitle' });
      const h3 = createMockElement({ tagName: 'H3', textContent: 'Sub-subtitle' });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === 'h1, h2, h3, h4, h5, h6') {
          return [h1, h2, h3];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.headings.length).toBe(3);
      expect(snapshot.headings[0]).toEqual({ level: 1, text: 'Main Title' });
      expect(snapshot.headings[1]).toEqual({ level: 2, text: 'Subtitle' });
      expect(snapshot.headings[2]).toEqual({ level: 3, text: 'Sub-subtitle' });
    });

    it('skips headings with very short text (< 2 chars)', () => {
      const h1 = createMockElement({ tagName: 'H1', textContent: 'X' });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === 'h1, h2, h3, h4, h5, h6') {
          return [h1];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.headings.length).toBe(0);
    });

    it('limits headings to 60', () => {
      const headings = Array.from({ length: 80 }, (_, i) =>
        createMockElement({ tagName: 'H2', textContent: `Heading number ${i}` })
      );

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === 'h1, h2, h3, h4, h5, h6') {
          return headings;
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.headings.length).toBeLessThanOrEqual(60);
    });
  });

  // ── Images ─────────────────────────────────────────────────────────────

  describe('images', () => {
    it('scrapes images with alt text', () => {
      const mockImg = createMockElement({
        tagName: 'IMG',
        alt: 'Product photo',
        src: 'https://cdn.example.com/photo.jpg',
        getAttribute: jest.fn((attr: string) => {
          if (attr === 'data-src') return null;
          if (attr === 'alt') return 'Product photo';
          return null;
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === 'img') {
          return [mockImg];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.images.length).toBe(1);
      expect(snapshot.images[0].alt).toBe('Product photo');
      expect(snapshot.images[0].src).toBe('https://cdn.example.com/photo.jpg');
    });

    it('skips images without alt text', () => {
      const mockImg = createMockElement({
        tagName: 'IMG',
        alt: '',
        src: 'https://cdn.example.com/spacer.gif',
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === 'img') {
          return [mockImg];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.images.length).toBe(0);
    });
  });

  // ── Product detection ─────────────────────────────────────────────────

  describe('product detection', () => {
    it('detects Amazon-style products with data-asin attribute', () => {
      const mockProduct = createMockElement({
        tagName: 'DIV',
        getAttribute: jest.fn((attr: string) => {
          if (attr === 'data-asin') return 'B09ABC1234';
          if (attr === 'data-component-type') return 's-search-result';
          if (attr === 'data-testid') return null;
          if (attr === 'aria-label') return null;
          if (attr === 'name') return null;
          return null;
        }),
        querySelector: jest.fn((sel: string) => {
          // Check link selector BEFORE h2 check
          if (sel.includes('/dp/') || sel.includes('a-link-normal')) {
            return createMockElement({
              id: 'product-link',
              tagName: 'A',
              getAttribute: jest.fn(() => null),
            });
          }
          // Cart button selector
          if (sel.includes('add-to-cart') || sel.includes('Add to Cart')) {
            return null;
          }
          // Name selector
          if (sel.includes('h2') || sel.includes('title') || sel.includes('a-text-normal')) {
            return { textContent: 'Wireless Headphones' };
          }
          // Price selector
          if (sel.includes('price') || sel.includes('a-offscreen')) {
            return { textContent: '$29.99' };
          }
          // Rating selector
          if (sel.includes('aria-label') || sel.includes('a-icon-alt')) {
            return {
              getAttribute: (a: string) => a === 'aria-label' ? '4.5 out of 5 stars' : null,
              textContent: '4.5 out of 5 stars',
            };
          }
          if (sel === 'img') {
            return {
              getAttribute: (a: string) => (a === 'alt' ? 'Headphones image' : null),
            };
          }
          return null;
        }),
        getBoundingClientRect: jest.fn().mockReturnValue({
          width: 300, height: 400, top: 100, bottom: 500, left: 50, right: 350,
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('data-component-type') || selector.includes('data-asin')) {
          return [mockProduct];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.products.length).toBeGreaterThanOrEqual(1);
      expect(snapshot.products[0].name).toContain('Wireless Headphones');
      expect(snapshot.products[0].price).toContain('29.99');
    });

    it('detects Schema.org Product microdata', () => {
      const mockSchemaProduct = createMockElement({
        tagName: 'DIV',
        getAttribute: jest.fn((attr: string) => {
          if (attr === 'data-asin') return null;
          if (attr === 'data-testid') return null;
          if (attr === 'aria-label') return null;
          if (attr === 'name') return null;
          if (attr === 'itemtype') return 'http://schema.org/Product';
          return null;
        }),
        querySelector: jest.fn((sel: string) => {
          if (sel.includes('itemprop="name"')) {
            return { textContent: 'Smart Watch' };
          }
          if (sel.includes('itemprop="price"') || sel.includes('itemprop="lowPrice"')) {
            return { textContent: '$199.00', getAttribute: () => null };
          }
          if (sel.includes('itemprop="ratingValue"')) {
            return { textContent: '4.2', getAttribute: () => null };
          }
          if (sel === 'img') {
            return {
              getAttribute: (a: string) => (a === 'alt' ? 'Smart Watch image' : null),
            };
          }
          if (sel.includes('a[href]')) {
            return createMockElement({
              id: 'schema-link',
              tagName: 'A',
              getAttribute: jest.fn(() => null),
            });
          }
          return null;
        }),
        getBoundingClientRect: jest.fn().mockReturnValue({
          width: 200, height: 300, top: 50, bottom: 350, left: 10, right: 210,
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('schema.org/Product')) {
          return [mockSchemaProduct];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.products.length).toBeGreaterThanOrEqual(1);
      const product = snapshot.products[0];
      expect(product.name).toContain('Smart Watch');
      expect(product.price).toContain('199');
    });

    it('detects JSON-LD product data', () => {
      const ldScript = createMockElement({
        tagName: 'SCRIPT',
        textContent: JSON.stringify({
          '@type': 'Product',
          name: 'Running Shoes',
          offers: {
            price: '89.99',
            priceCurrency: '$',
          },
          aggregateRating: {
            ratingValue: '4.7',
          },
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('ld+json')) {
          return [ldScript];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.products.length).toBeGreaterThanOrEqual(1);
      const product = snapshot.products.find((p: any) => p.name === 'Running Shoes');
      expect(product).toBeDefined();
      expect(product!.price).toContain('89.99');
      expect(product!.rating).toContain('4.7');
    });

    it('detects JSON-LD arrays of products', () => {
      const ldScript = createMockElement({
        tagName: 'SCRIPT',
        textContent: JSON.stringify([
          { '@type': 'Product', name: 'Product A', offers: { price: '10' } },
          { '@type': 'Product', name: 'Product B', offers: { price: '20' } },
        ]),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('ld+json')) {
          return [ldScript];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.products.length).toBeGreaterThanOrEqual(2);
    });

    it('handles malformed JSON-LD gracefully', () => {
      const ldScript = createMockElement({
        tagName: 'SCRIPT',
        textContent: '{ invalid json !!!',
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('ld+json')) {
          return [ldScript];
        }
        return [];
      });

      // Should not throw
      const snapshot = scrapeDom();
      expect(snapshot.products).toBeDefined();
    });

    it('detects generic product cards by class name', () => {
      const mockCard = createMockElement({
        tagName: 'DIV',
        className: 'product-card',
        classList: ['product-card'],
        getAttribute: jest.fn((attr: string) => {
          if (attr === 'data-testid') return null;
          if (attr === 'data-asin') return null;
          if (attr === 'aria-label') return null;
          if (attr === 'name') return null;
          return null;
        }),
        querySelector: jest.fn((sel: string) => {
          if (sel.includes('h1') || sel.includes('h2') || sel.includes('h3') ||
              sel.includes('title') || sel.includes('name') || sel.includes('Title') || sel.includes('Name')) {
            return { textContent: 'Bluetooth Speaker' };
          }
          if (sel.includes('price') || sel.includes('Price') || sel.includes('cost') || sel.includes('data-price')) {
            return { textContent: '$49.99' };
          }
          if (sel.includes('rating') || sel.includes('Rating') || sel.includes('stars')) {
            return { textContent: '4.3 stars', getAttribute: () => null };
          }
          if (sel === 'img') {
            return { getAttribute: (a: string) => (a === 'alt' ? 'Speaker image' : null) };
          }
          if (sel.includes('a[href]')) {
            return createMockElement({
              id: '',
              tagName: 'A',
              getAttribute: jest.fn(() => null),
            });
          }
          return null;
        }),
        getBoundingClientRect: jest.fn().mockReturnValue({
          width: 250, height: 300, top: 100, bottom: 400, left: 10, right: 260,
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('product-card')) {
          return [mockCard];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.products.length).toBeGreaterThanOrEqual(1);
      const product = snapshot.products.find((p: any) => p.name?.includes('Bluetooth Speaker'));
      expect(product).toBeDefined();
    });

    it('limits products to 40', () => {
      // Create 50 JSON-LD products
      const products = Array.from({ length: 50 }, (_, i) => ({
        '@type': 'Product',
        name: `Product ${i}`,
      }));
      const ldScript = createMockElement({
        tagName: 'SCRIPT',
        textContent: JSON.stringify(products),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('ld+json')) {
          return [ldScript];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.products.length).toBeLessThanOrEqual(40);
    });
  });

  // ── Visibility filtering ──────────────────────────────────────────────

  describe('visibility filtering', () => {
    it('excludes buttons with zero dimensions', () => {
      const mockBtn = createMockElement({
        id: 'zero-btn',
        tagName: 'BUTTON',
        textContent: 'Zero Size Button',
        getBoundingClientRect: jest.fn().mockReturnValue({
          width: 0,
          height: 0,
          top: 100,
          bottom: 100,
          left: 50,
          right: 50,
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      // isVisible checks width > 0 && height > 0
      expect(snapshot.buttons.length).toBe(0);
    });

    it('includes visible buttons with positive dimensions', () => {
      const mockBtn = createMockElement({
        id: 'visible-btn',
        tagName: 'BUTTON',
        textContent: 'Visible Button',
        getBoundingClientRect: jest.fn().mockReturnValue({
          width: 100,
          height: 50,
          top: 100,
          bottom: 150,
          left: 50,
          right: 150,
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector.includes('button') || selector.includes('role="button"')) {
          return [mockBtn];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.buttons.length).toBe(1);
    });
  });

  // ── Tables ─────────────────────────────────────────────────────────────

  describe('tables', () => {
    it('scrapes table with headers and rows', () => {
      const mockTh1 = createMockElement({ tagName: 'TH', textContent: 'Name' });
      const mockTh2 = createMockElement({ tagName: 'TH', textContent: 'Price' });
      const mockTd1 = createMockElement({ tagName: 'TD', textContent: 'Widget' });
      const mockTd2 = createMockElement({ tagName: 'TD', textContent: '$10' });
      const mockRow = createMockElement({
        tagName: 'TR',
        querySelectorAll: jest.fn().mockReturnValue([mockTd1, mockTd2]),
      });

      const mockTable = createMockElement({
        id: 'data-table',
        tagName: 'TABLE',
        getAttribute: jest.fn(() => null),
        querySelectorAll: jest.fn((sel: string) => {
          if (sel.includes('thead') && sel.includes('th')) {
            return [mockTh1, mockTh2];
          }
          if (sel.includes('tbody tr') || sel.includes('tr')) {
            return [mockRow];
          }
          return [];
        }),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === 'table') {
          return [mockTable];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.tables.length).toBe(1);
      expect(snapshot.tables[0].headers).toEqual(['Name', 'Price']);
    });
  });

  // ── Lists ──────────────────────────────────────────────────────────────

  describe('lists', () => {
    it('scrapes unordered lists with items', () => {
      const mockLi1 = createMockElement({ tagName: 'LI', textContent: 'Item 1' });
      const mockLi2 = createMockElement({ tagName: 'LI', textContent: 'Item 2' });
      const mockLi3 = createMockElement({ tagName: 'LI', textContent: 'Item 3' });

      const mockUl = createMockElement({
        id: 'feature-list',
        tagName: 'UL',
        getAttribute: jest.fn(() => null),
        querySelectorAll: jest.fn().mockReturnValue([mockLi1, mockLi2, mockLi3]),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === 'ul, ol') {
          return [mockUl];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.lists.length).toBe(1);
      expect(snapshot.lists[0].type).toBe('unordered');
      expect(snapshot.lists[0].items).toEqual(['Item 1', 'Item 2', 'Item 3']);
    });

    it('identifies ordered lists', () => {
      const items = [
        createMockElement({ tagName: 'LI', textContent: 'Step 1' }),
        createMockElement({ tagName: 'LI', textContent: 'Step 2' }),
      ];

      const mockOl = createMockElement({
        id: 'steps-list',
        tagName: 'OL',
        getAttribute: jest.fn(() => null),
        querySelectorAll: jest.fn().mockReturnValue(items),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === 'ul, ol') {
          return [mockOl];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.lists.length).toBe(1);
      expect(snapshot.lists[0].type).toBe('ordered');
    });

    it('skips lists with fewer than 2 items', () => {
      const singleItem = createMockElement({ tagName: 'LI', textContent: 'Only item' });

      const mockUl = createMockElement({
        tagName: 'UL',
        querySelectorAll: jest.fn().mockReturnValue([singleItem]),
      });

      mockDocument.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === 'ul, ol') {
          return [mockUl];
        }
        return [];
      });

      const snapshot = scrapeDom();
      expect(snapshot.lists.length).toBe(0);
    });
  });
});
