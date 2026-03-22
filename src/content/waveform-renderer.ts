// ---------------------------------------------------------------------------
// Waveform renderer — amplitude visualization with bars
// Extracted from cursor-bubble.ts (pure refactor)
// ---------------------------------------------------------------------------

export const BAR_COUNT = 10;
export const MIN_HEIGHT = 2;
export const MAX_HEIGHT = 18;

/**
 * Manages the listening-state waveform bar elements.
 * All DOM elements are created generically (document.createElement) so they
 * work inside any container, including a Shadow DOM root.
 */
export class WaveformRenderer {
  private bars: HTMLDivElement[] = [];
  private ampLogCount = 0;

  /** The current bar elements (read-only snapshot). */
  getBars(): HTMLDivElement[] {
    return this.bars;
  }

  /**
   * Create the waveform container and bars.
   * Returns the wrapper `<div>` — caller appends it to the bubble.
   */
  createWaveform(): HTMLDivElement {
    const waveformEl = document.createElement('div');
    waveformEl.className = 'screensense-waveform';

    this.bars = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      const bar = document.createElement('div');
      bar.className = 'wave-bar';
      waveformEl.appendChild(bar);
      this.bars.push(bar);
    }

    return waveformEl;
  }

  /**
   * Update bar heights from microphone frequency data.
   * Should only be called while the waveform is mounted (listening state).
   *
   * @returns `true` if bars were updated, `false` if skipped.
   */
  updateAmplitude(frequencyData: Uint8Array): boolean {
    if (this.bars.length === 0) {
      if (this.ampLogCount < 3) {
        console.log('[ScreenSense][waveform] updateAmplitude SKIPPED: bars=', this.bars.length);
        this.ampLogCount++;
      }
      return false;
    }

    const binCount = frequencyData.length;
    const step = Math.floor(binCount / BAR_COUNT);

    if (this.ampLogCount < 5) {
      const max = Math.max(...Array.from(frequencyData));
      console.log(`[ScreenSense][waveform] updateAmplitude applying: bins=${binCount} step=${step} max=${max} bars=${this.bars.length}`);
      this.ampLogCount++;
    }

    for (let i = 0; i < BAR_COUNT; i++) {
      const index = Math.min(i * step, binCount - 1);
      const value = frequencyData[index];
      const height = MIN_HEIGHT + (value / 255) * (MAX_HEIGHT - MIN_HEIGHT);
      this.bars[i].style.height = `${height}px`;
    }

    return true;
  }

  /** Reset bars to minimum height. */
  reset(): void {
    for (const bar of this.bars) {
      bar.style.height = `${MIN_HEIGHT}px`;
    }
  }

  /** Reset the amplitude log counter (e.g. when bubble is shown fresh). */
  resetLogCount(): void {
    this.ampLogCount = 0;
  }

  /** Release references to DOM elements. */
  cleanup(): void {
    this.bars = [];
    this.ampLogCount = 0;
  }
}
