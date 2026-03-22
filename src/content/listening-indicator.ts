const BAR_COUNT = 16;
const MIN_HEIGHT = 2;
const MAX_HEIGHT = 24;
const CURSOR_OFFSET_Y = 20;

// Inline styles for Shadow DOM isolation — these never leak to the host page
const INDICATOR_STYLES = `
.screensense-indicator {
  position: fixed;
  z-index: 2147483647;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  padding: 6px 10px;
  border-radius: 12px;
  background: rgba(30, 30, 30, 0.7);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  pointer-events: none;
  transition: opacity 0.15s ease;
  opacity: 1;
}

.screensense-indicator.fade-out {
  opacity: 0;
}

.screensense-bar {
  width: 3px;
  min-height: 2px;
  max-height: 24px;
  height: 2px;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 1.5px;
  transition: height 0.05s ease-out;
}
`;

export class ListeningIndicator {
  private container: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private bars: HTMLDivElement[] = [];
  private visible = false;

  show(cursorX: number, cursorY: number): void {
    if (this.visible) return;

    // Create host container
    this.container = document.createElement('div');
    this.container.id = 'screensense-indicator-host';
    this.container.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';

    // Attach Shadow DOM to isolate styles
    this.shadowRoot = this.container.attachShadow({ mode: 'closed' });

    // Inject styles into shadow root
    const styleEl = document.createElement('style');
    styleEl.textContent = INDICATOR_STYLES;
    this.shadowRoot.appendChild(styleEl);

    // Create indicator wrapper
    const indicator = document.createElement('div');
    indicator.className = 'screensense-indicator';
    indicator.style.position = 'fixed';
    indicator.style.left = `${cursorX}px`;
    indicator.style.top = `${cursorY + CURSOR_OFFSET_Y}px`;
    indicator.style.transform = 'translate(-50%, 0)';

    // Create bars
    this.bars = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      const bar = document.createElement('div');
      bar.className = 'screensense-bar';
      indicator.appendChild(bar);
      this.bars.push(bar);
    }

    this.shadowRoot.appendChild(indicator);
    document.body.appendChild(this.container);
    this.visible = true;
  }

  updatePosition(cursorX: number, cursorY: number): void {
    if (!this.shadowRoot || !this.visible) return;

    const indicator = this.shadowRoot.querySelector(
      '.screensense-indicator'
    ) as HTMLDivElement | null;
    if (indicator) {
      indicator.style.left = `${cursorX}px`;
      indicator.style.top = `${cursorY + CURSOR_OFFSET_Y}px`;
    }
  }

  updateAmplitude(frequencyData: Uint8Array): void {
    if (!this.visible || this.bars.length === 0) return;

    const binCount = frequencyData.length;
    const step = Math.floor(binCount / BAR_COUNT);

    for (let i = 0; i < BAR_COUNT; i++) {
      // Sample evenly-spaced values from frequency data
      const index = Math.min(i * step, binCount - 1);
      const value = frequencyData[index];
      // Map 0-255 to MIN_HEIGHT-MAX_HEIGHT
      const height = MIN_HEIGHT + (value / 255) * (MAX_HEIGHT - MIN_HEIGHT);
      this.bars[i].style.height = `${height}px`;
    }
  }

  hideForScreenshot(): void {
    if (this.container) {
      this.container.style.display = 'none';
    }
  }

  showAfterScreenshot(): void {
    if (this.container) {
      this.container.style.display = '';
    }
  }

  hide(): void {
    if (!this.visible || !this.shadowRoot) return;

    const indicator = this.shadowRoot.querySelector(
      '.screensense-indicator'
    ) as HTMLDivElement | null;

    if (indicator) {
      indicator.classList.add('fade-out');

      // Remove after transition completes (150ms)
      setTimeout(() => {
        this.removeFromDom();
      }, 150);
    } else {
      this.removeFromDom();
    }

    this.visible = false;
  }

  private removeFromDom(): void {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.shadowRoot = null;
    this.bars = [];
  }

  destroy(): void {
    this.removeFromDom();
    this.visible = false;
  }
}
