export interface DomSnapshot {
  url: string;
  title: string;
  description: string;
  canonicalUrl: string;

  // Semantic page structure
  sections: Array<{
    type: string; // 'header' | 'nav' | 'main' | 'sidebar' | 'footer' | 'section' | 'article'
    heading?: string;
    summary: string; // first 200 chars of text content
  }>;

  // Interactive elements with real CSS selectors
  buttons: ElementInfo[];
  links: ElementInfo[];
  inputs: InputInfo[];
  forms: FormInfo[];

  // Structured content
  headings: Array<{ level: number; text: string }>;
  images: Array<{ alt: string; src: string; selector: string }>;
  tables: Array<{
    selector: string;
    headers: string[];
    rowCount: number;
    sampleRows: string[][]; // first 5 rows
  }>;
  lists: Array<{
    selector: string;
    type: 'ordered' | 'unordered';
    items: string[]; // first 10 items, truncated
  }>;

  // Product detection (e-commerce pages)
  products: Array<{
    name: string;
    price?: string;
    rating?: string;
    imageAlt?: string;
    selector: string;
    linkSelector?: string;
    addToCartSelector?: string;
  }>;

  // Full page text (cleaned, up to 5000 chars)
  text_content: string;
}

export interface ElementInfo {
  selector: string;
  text: string;
  role?: string;     // semantic role: "button", "link", "submit", "nav", etc.
  href?: string;
  visible: boolean;
  inViewport: boolean;
  bbox?: { x: number; y: number; w: number; h: number };
}

export interface InputInfo {
  selector: string;
  type: string;
  value: string;
  placeholder: string;
  label?: string;
  visible: boolean;
  inViewport: boolean;
  bbox?: { x: number; y: number; w: number; h: number };
}

export interface FormInfo {
  selector: string;
  action: string;
  method: string;
  inputs: InputInfo[];
}

/* ------------------------------------------------------------------ */
/*  Helper utilities                                                   */
/* ------------------------------------------------------------------ */

function isVisible(el: Element): boolean {
  const visible = el.checkVisibility?.() ?? true;
  if (!visible) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isInViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return (
    rect.bottom > 0 &&
    rect.top < window.innerHeight &&
    rect.right > 0 &&
    rect.left < window.innerWidth
  );
}

function getBBox(el: Element): { x: number; y: number; w: number; h: number } {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    w: Math.round(rect.width),
    h: Math.round(rect.height),
  };
}

function buildSelector(el: Element): string {
  // Priority 1: id
  if (el.id) {
    return `#${CSS.escape(el.id)}`;
  }

  // Priority 2: data-testid
  const testId = el.getAttribute('data-testid');
  if (testId) {
    return `[data-testid="${CSS.escape(testId)}"]`;
  }

  // Priority 3: common data-* attributes (product IDs, video IDs, etc.)
  for (const attr of ['data-asin', 'data-video-id', 'data-id', 'data-product-id', 'data-item-id']) {
    const val = el.getAttribute(attr);
    if (val && val.length > 0 && val.length < 60) {
      return `[${attr}="${CSS.escape(val)}"]`;
    }
  }

  // Priority 4: aria-label (if reasonably short)
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.length < 80) {
    return `[aria-label="${CSS.escape(ariaLabel)}"]`;
  }

  // Priority 5: title attribute (unique on many elements)
  const title = el.getAttribute('title');
  if (title && title.length > 2 && title.length < 80) {
    const tag = el.tagName.toLowerCase();
    return `${tag}[title="${CSS.escape(title)}"]`;
  }

  // Priority 6: href attribute for links (much more reliable than classes)
  if (el.tagName === 'A') {
    const href = el.getAttribute('href');
    if (href && href.length < 150 && href !== '#' && href !== '/') {
      // Use href substring match for cleaner selectors
      const hrefKey = href.includes('?') ? href.split('?')[0] : href;
      if (hrefKey.length > 1 && hrefKey.length < 80) {
        return `a[href*="${CSS.escape(hrefKey)}"]`;
      }
    }
  }

  // Priority 6: name attribute (useful for inputs)
  const name = el.getAttribute('name');
  if (name) {
    const tag = el.tagName.toLowerCase();
    return `${tag}[name="${CSS.escape(name)}"]`;
  }

  // Priority 7: tag + class path with nth-of-type
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList)
    .filter(c => !c.match(/^[a-z]{1,3}_[a-zA-Z0-9_-]+$/)) // skip CSS-module hashes
    .slice(0, 3)
    .map((c) => `.${CSS.escape(c)}`)
    .join('');

  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(
      (s) => s.tagName === el.tagName
    );
    if (siblings.length > 1) {
      const idx = siblings.indexOf(el) + 1;
      const parentSel = parent.id
        ? `#${CSS.escape(parent.id)}`
        : parent.tagName.toLowerCase();
      return `${parentSel} > ${tag}${classes}:nth-of-type(${idx})`;
    }
  }

  return `${tag}${classes}`;
}

function trimText(text: string | null | undefined, max = 200): string {
  if (!text) return '';
  return text.trim().replace(/\s+/g, ' ').slice(0, max);
}

/** Find the <label> text associated with a form control */
function findLabel(el: HTMLElement): string | undefined {
  // Explicit <label for="id">
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return trimText(label.textContent, 100);
  }
  // Implicit: input nested inside label
  const parent = el.closest('label');
  if (parent) return trimText(parent.textContent, 100);
  // aria-label
  const aria = el.getAttribute('aria-label');
  if (aria) return trimText(aria, 100);
  // aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ref = document.getElementById(labelledBy);
    if (ref) return trimText(ref.textContent, 100);
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  Section detection                                                  */
/* ------------------------------------------------------------------ */

function scrapeSections(): DomSnapshot['sections'] {
  const sections: DomSnapshot['sections'] = [];
  const semanticTags: Record<string, string> = {
    HEADER: 'header',
    NAV: 'nav',
    MAIN: 'main',
    ASIDE: 'sidebar',
    FOOTER: 'footer',
    ARTICLE: 'article',
    SECTION: 'section',
  };

  // Collect semantic elements
  const els = document.querySelectorAll(
    'header, nav, main, aside, footer, article, section'
  );

  const seen = new Set<Element>();
  els.forEach((el) => {
    // Skip nested duplicates — only process the outermost of each type
    if (seen.has(el)) return;
    // Skip invisible
    if (!isVisible(el)) return;

    const type = semanticTags[el.tagName] || 'section';

    // Find the first heading inside
    const headingEl = el.querySelector('h1, h2, h3, h4, h5, h6');
    const heading = headingEl ? trimText(headingEl.textContent, 120) : undefined;

    const text = trimText(el.textContent, 200);
    if (text.length < 5) return; // skip empty sections

    sections.push({ type, heading, summary: text });
    seen.add(el);
  });

  // If no semantic tags found, create a synthetic "main" section from body
  if (sections.length === 0 && document.body) {
    const h1 = document.querySelector('h1');
    sections.push({
      type: 'main',
      heading: h1 ? trimText(h1.textContent, 120) : undefined,
      summary: trimText(document.body.textContent, 200),
    });
  }

  return sections.slice(0, 30);
}

/* ------------------------------------------------------------------ */
/*  Element classification                                             */
/* ------------------------------------------------------------------ */

/** Classify an element's semantic purpose so Nova knows what it does */
function classifyElement(el: Element, text: string): string | undefined {
  const lower = text.toLowerCase();
  const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
  const id = (el.id || '').toLowerCase();
  const name = (el.getAttribute('name') || '').toLowerCase();
  const type = (el as HTMLInputElement).type?.toLowerCase() || '';

  // Cart/purchase actions
  if (lower.includes('add to cart') || lower.includes('add to basket') || id.includes('add-to-cart') || name.includes('add-to-cart')) return 'add-to-cart';
  if (lower.includes('buy now') || id.includes('buy-now')) return 'buy-now';
  if (lower.includes('checkout') || lower.includes('proceed to')) return 'checkout';

  // Search
  if (type === 'submit' || type === 'search') return 'submit';
  if (ariaLabel.includes('search') || lower === 'search' || lower === 'go') return 'search-submit';

  // Navigation
  if (lower.includes('next') || lower.includes('previous') || lower.includes('back')) return 'navigation';
  if (lower.includes('close') || lower.includes('dismiss') || lower === 'x' || lower === '×') return 'close';

  // Sort/filter (avoid these — they're UI controls, not product actions)
  if (lower.includes('sort by') || lower.includes('filter') || id.includes('autoid')) return 'sort-filter';

  // Quantity
  if (lower.includes('qty') || lower.includes('quantity') || name.includes('quantity')) return 'quantity';

  return undefined;
}

/* ------------------------------------------------------------------ */
/*  Interactive elements                                               */
/* ------------------------------------------------------------------ */

function scrapeButtons(): ElementInfo[] {
  const els = Array.from(
    document.querySelectorAll(
      'button, [role="button"], input[type="submit"], input[type="button"], a[role="button"]'
    )
  );
  const results: ElementInfo[] = [];
  for (const el of els) {
    if (results.length >= 100) break;
    if (!isVisible(el)) continue;
    const text = trimText(
      el.textContent || (el as HTMLInputElement).value || el.getAttribute('aria-label'),
      200
    );
    if (!text) continue;
    results.push({
      selector: buildSelector(el),
      text,
      role: classifyElement(el, text),
      visible: true,
      inViewport: isInViewport(el),
      bbox: getBBox(el),
    });
  }
  return results;
}

function scrapeLinks(): ElementInfo[] {
  const els = Array.from(document.querySelectorAll('a[href]'));
  const results: ElementInfo[] = [];
  for (const el of els) {
    if (results.length >= 100) break;
    if (!isVisible(el)) continue;
    const anchor = el as HTMLAnchorElement;
    const text = trimText(
      anchor.textContent || anchor.getAttribute('aria-label'),
      200
    );
    if (!text) continue;
    // Classify link purpose
    const href = anchor.href || '';
    let linkRole: string | undefined;
    if (href.includes('/dp/') || href.includes('/product/')) linkRole = 'product-link';
    else if (href.includes('/cart') || href.includes('/basket')) linkRole = 'cart-link';
    else if (href.includes('/watch') || href.includes('/video')) linkRole = 'video-link';

    results.push({
      selector: buildSelector(el),
      text,
      role: linkRole,
      href: anchor.href || undefined,
      visible: true,
      inViewport: isInViewport(el),
      bbox: getBBox(el),
    });
  }
  return results;
}

function buildInputInfo(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): InputInfo {
  return {
    selector: buildSelector(el),
    type:
      el instanceof HTMLInputElement
        ? el.type || 'text'
        : el instanceof HTMLSelectElement
          ? 'select'
          : 'textarea',
    value:
      el instanceof HTMLSelectElement
        ? el.options[el.selectedIndex]?.text || el.value
        : el.value || '',
    placeholder: (el as HTMLInputElement | HTMLTextAreaElement).placeholder || '',
    label: findLabel(el),
    visible: isVisible(el),
    inViewport: isInViewport(el),
    bbox: getBBox(el),
  };
}

function scrapeInputs(): InputInfo[] {
  const els = Array.from(
    document.querySelectorAll('input, textarea, select')
  ).slice(0, 50) as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[];
  return els.map(buildInputInfo);
}

function scrapeForms(): FormInfo[] {
  const formEls = Array.from(document.querySelectorAll('form')).slice(0, 15) as HTMLFormElement[];
  return formEls.map((form) => {
    const formInputEls = Array.from(
      form.querySelectorAll('input, textarea, select')
    ).slice(0, 15) as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[];

    return {
      selector: buildSelector(form),
      action: form.action || '',
      method: (form.method || 'get').toUpperCase(),
      inputs: formInputEls.map(buildInputInfo),
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Content extraction                                                 */
/* ------------------------------------------------------------------ */

function scrapeHeadings(): Array<{ level: number; text: string }> {
  const els = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  const results: Array<{ level: number; text: string }> = [];
  els.forEach((el) => {
    if (results.length >= 60) return;
    const text = trimText(el.textContent, 200);
    if (text.length < 2) return;
    const level = parseInt(el.tagName[1], 10);
    results.push({ level, text });
  });
  return results;
}

function scrapeImages(): Array<{ alt: string; src: string; selector: string }> {
  const els = Array.from(document.querySelectorAll('img'));
  const results: Array<{ alt: string; src: string; selector: string }> = [];
  for (const el of els) {
    if (results.length >= 50) break;
    const alt = trimText(el.alt, 200);
    if (!alt) continue; // skip images without alt text
    results.push({
      alt,
      src: el.src || el.getAttribute('data-src') || '',
      selector: buildSelector(el),
    });
  }
  return results;
}

function scrapeTables(): DomSnapshot['tables'] {
  const tableEls = Array.from(document.querySelectorAll('table')).slice(0, 10);
  return tableEls.map((table) => {
    // Headers
    const headerCells = table.querySelectorAll('thead th, thead td, tr:first-child th');
    const headers = Array.from(headerCells)
      .map((c) => trimText(c.textContent, 100))
      .slice(0, 15);

    // Rows — skip header row, take first 5
    const bodyRows = Array.from(table.querySelectorAll('tbody tr, tr')).slice(
      headers.length > 0 ? 0 : 1,
      6
    );
    const sampleRows = bodyRows.map((row) =>
      Array.from(row.querySelectorAll('td, th'))
        .map((c) => trimText(c.textContent, 100))
        .slice(0, 15)
    );

    return {
      selector: buildSelector(table),
      headers,
      rowCount: table.querySelectorAll('tbody tr, tr').length,
      sampleRows,
    };
  });
}

function scrapeLists(): DomSnapshot['lists'] {
  const listEls = Array.from(document.querySelectorAll('ul, ol')).filter(
    (el) => {
      // Skip nav-like lists (common for menus) and tiny lists
      const items = el.querySelectorAll(':scope > li');
      return items.length >= 2 && items.length <= 200;
    }
  );
  return listEls.slice(0, 20).map((el) => ({
    selector: buildSelector(el),
    type: el.tagName === 'OL' ? 'ordered' as const : 'unordered' as const,
    items: Array.from(el.querySelectorAll(':scope > li'))
      .slice(0, 10)
      .map((li) => trimText(li.textContent, 150)),
  }));
}

/* ------------------------------------------------------------------ */
/*  Product detection                                                  */
/* ------------------------------------------------------------------ */

function scrapeProducts(): DomSnapshot['products'] {
  const products: DomSnapshot['products'] = [];
  const seen = new Set<Element>();

  // Strategy 1: Amazon-specific selectors
  const amazonResults = document.querySelectorAll(
    '[data-component-type="s-search-result"], [data-asin]:not([data-asin=""])'
  );
  amazonResults.forEach((el) => {
    if (seen.has(el) || products.length >= 40) return;
    seen.add(el);
    const nameEl = el.querySelector('h2, [data-cy="title-recipe"] span, .a-text-normal');
    const name = trimText(nameEl?.textContent, 200);
    if (!name) return;

    const priceEl = el.querySelector('.a-price .a-offscreen, .a-price-whole, [data-a-color="price"] span');
    const ratingEl = el.querySelector('[aria-label*="out of"], .a-icon-alt');
    const imgEl = el.querySelector('img');
    const linkEl = el.querySelector('a[href*="/dp/"], a.a-link-normal, h2 a');
    const cartBtn = el.querySelector('[name="submit.add-to-cart"], [id*="add-to-cart"], button[aria-label*="Add to Cart"]');

    products.push({
      name,
      price: trimText(priceEl?.textContent, 30) || undefined,
      rating: trimText(ratingEl?.getAttribute('aria-label') || ratingEl?.textContent, 50) || undefined,
      imageAlt: imgEl ? trimText(imgEl.getAttribute('alt'), 120) : undefined,
      selector: buildSelector(el),
      linkSelector: linkEl ? buildSelector(linkEl) : undefined,
      addToCartSelector: cartBtn ? buildSelector(cartBtn) : undefined,
    });
  });

  // Strategy 2: Schema.org Product microdata
  const schemaProducts = document.querySelectorAll('[itemtype*="schema.org/Product"]');
  schemaProducts.forEach((el) => {
    if (seen.has(el) || products.length >= 40) return;
    seen.add(el);
    const nameEl = el.querySelector('[itemprop="name"]');
    const name = trimText(nameEl?.textContent, 200);
    if (!name) return;

    const priceEl = el.querySelector('[itemprop="price"], [itemprop="lowPrice"]');
    const ratingEl = el.querySelector('[itemprop="ratingValue"]');
    const imgEl = el.querySelector('img');
    const linkEl = el.querySelector('a[href]');

    products.push({
      name,
      price: trimText(priceEl?.textContent || priceEl?.getAttribute('content'), 30) || undefined,
      rating: trimText(ratingEl?.textContent || ratingEl?.getAttribute('content'), 50) || undefined,
      imageAlt: imgEl ? trimText(imgEl.getAttribute('alt'), 120) : undefined,
      selector: buildSelector(el),
      linkSelector: linkEl ? buildSelector(linkEl) : undefined,
    });
  });

  // Strategy 3: Generic product-like containers via class name heuristics
  const genericSelectors = [
    '[class*="product-card"]',
    '[class*="product_card"]',
    '[class*="productCard"]',
    '[class*="product-item"]',
    '[class*="product_item"]',
    '[class*="ProductCard"]',
    '[class*="search-result"]',
    '[class*="item-card"]',
    '[class*="item_card"]',
    '[data-product-id]',
    '[data-item-id]',
    '[data-product]',
  ];

  for (const sel of genericSelectors) {
    try {
      const els = document.querySelectorAll(sel);
      els.forEach((el) => {
        if (seen.has(el) || products.length >= 40) return;
        // Skip if it's a very small element (probably not a product card)
        const rect = el.getBoundingClientRect();
        if (rect.width < 100 || rect.height < 50) return;
        seen.add(el);

        // Try to extract a product name from headings or prominent text
        const nameEl =
          el.querySelector('h1, h2, h3, h4, [class*="title"], [class*="name"], [class*="Title"], [class*="Name"]') ||
          el.querySelector('a');
        const name = trimText(nameEl?.textContent, 200);
        if (!name || name.length < 3) return;

        // Price: look for common price patterns
        const priceEl = el.querySelector(
          '[class*="price"], [class*="Price"], [class*="cost"], [data-price]'
        );
        const priceText = trimText(priceEl?.textContent, 30);
        // Only treat as price if it contains a currency symbol or digits
        const price = priceText && /[\d$€£¥₹]/.test(priceText) ? priceText : undefined;

        const ratingEl = el.querySelector('[class*="rating"], [class*="Rating"], [class*="stars"], [aria-label*="star"]');
        const imgEl = el.querySelector('img');
        const linkEl = el.querySelector('a[href]');
        const cartBtn = el.querySelector(
          'button[class*="cart"], button[class*="Cart"], [class*="add-to-cart"], [class*="addToCart"]'
        );

        products.push({
          name,
          price,
          rating: trimText(ratingEl?.textContent || ratingEl?.getAttribute('aria-label'), 50) || undefined,
          imageAlt: imgEl ? trimText(imgEl.getAttribute('alt'), 120) : undefined,
          selector: buildSelector(el),
          linkSelector: linkEl ? buildSelector(linkEl as Element) : undefined,
          addToCartSelector: cartBtn ? buildSelector(cartBtn) : undefined,
        });
      });
    } catch {
      // Invalid selector, skip
    }
  }

  // Strategy 4: JSON-LD structured data
  try {
    const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    ldScripts.forEach((script) => {
      if (products.length >= 40) return;
      try {
        const data = JSON.parse(script.textContent || '');
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (products.length >= 40) break;
          if (item['@type'] !== 'Product') continue;
          const name = trimText(item.name, 200);
          if (!name) continue;
          // Avoid duplicates by name
          if (products.some(p => p.name === name)) continue;
          products.push({
            name,
            price: item.offers?.price
              ? `${item.offers.priceCurrency || '$'}${item.offers.price}`
              : undefined,
            rating: item.aggregateRating?.ratingValue
              ? `${item.aggregateRating.ratingValue}/5`
              : undefined,
            selector: 'body', // no DOM element for JSON-LD
          });
        }
      } catch {
        // malformed JSON-LD, skip
      }
    });
  } catch {
    // skip
  }

  return products;
}

/* ------------------------------------------------------------------ */
/*  Text content extraction                                            */
/* ------------------------------------------------------------------ */

function scrapeTextContent(): string {
  const raw = document.body?.innerText || '';
  // Clean up: collapse whitespace, remove excessive blank lines
  const cleaned = raw
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned.slice(0, 8000);
}

/* ------------------------------------------------------------------ */
/*  Page metadata                                                      */
/* ------------------------------------------------------------------ */

function getMetaContent(name: string): string {
  const el =
    document.querySelector(`meta[name="${name}"]`) ||
    document.querySelector(`meta[property="${name}"]`) ||
    document.querySelector(`meta[property="og:${name}"]`);
  return (el as HTMLMetaElement)?.content || '';
}

function getCanonicalUrl(): string {
  const link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  return link?.href || '';
}

/* ------------------------------------------------------------------ */
/*  Main export                                                        */
/* ------------------------------------------------------------------ */

export function scrapeDom(): DomSnapshot {
  return {
    url: window.location.href,
    title: document.title || '',
    description: getMetaContent('description'),
    canonicalUrl: getCanonicalUrl(),

    sections: safe(scrapeSections, []),

    buttons: safe(scrapeButtons, []),
    links: safe(scrapeLinks, []),
    inputs: safe(scrapeInputs, []),
    forms: safe(scrapeForms, []),

    headings: safe(scrapeHeadings, []),
    images: safe(scrapeImages, []),
    tables: safe(scrapeTables, []),
    lists: safe(scrapeLists, []),

    products: safe(scrapeProducts, []),

    text_content: safe(scrapeTextContent, ''),
  };
}

/** Run a scraper function safely — return fallback on error instead of crashing */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (e) {
    console.warn(`[ScreenSense][dom-scraper] ${fn.name} failed:`, e);
    return fallback;
  }
}
