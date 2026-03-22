// ---------------------------------------------------------------------------
// Chat history — step log, task banner, conversation display
// Extracted from cursor-bubble.ts (pure refactor)
// ---------------------------------------------------------------------------

/** A single entry in the persistent chat history. */
export interface ChatEntry {
  type: 'question' | 'step' | 'result' | 'failed' | 'thinking' | 'done';
  text: string;
}

/** Icon status for step log entries. */
export type StepStatus = 'active' | 'done' | 'failed' | 'thinking';

/**
 * Manages the chat/step history that persists across bubble show/dismiss
 * cycles and renders step-log entries into the bubble DOM.
 *
 * All DOM elements are created via `document.createElement` so they work
 * inside a Shadow DOM context.
 */
export class ChatHistoryManager {
  private chatHistory: ChatEntry[] = [];
  private completedSteps: string[] = [];
  private currentTask = '';

  // DOM references (owned by the bubble container, set externally)
  private stepLogEl: HTMLDivElement | null = null;
  private taskBannerEl: HTMLDivElement | null = null;

  // ---------------------------------------------------------------------------
  // Public API — data management
  // ---------------------------------------------------------------------------

  /** Set the current task text and record it in history. */
  setTask(task: string): void {
    this.currentTask = task;
    this.completedSteps = [];
    this.chatHistory.push({ type: 'question', text: task });
  }

  /** Get the current task text. */
  getCurrentTask(): string {
    return this.currentTask;
  }

  /** Track a completed step for the done summary. */
  addCompletedStep(step: string): void {
    this.completedSteps.push(step);
  }

  /** Get completed steps. */
  getCompletedSteps(): string[] {
    return this.completedSteps;
  }

  /** Clear the persistent chat history. */
  clearHistory(): void {
    this.chatHistory = [];
    this.completedSteps = [];
    this.currentTask = '';
  }

  // ---------------------------------------------------------------------------
  // Public API — DOM rendering
  // ---------------------------------------------------------------------------

  /** Bind/unbind the step log DOM element. */
  setStepLogEl(el: HTMLDivElement | null): void {
    this.stepLogEl = el;
  }

  /** Get the current step log element. */
  getStepLogEl(): HTMLDivElement | null {
    return this.stepLogEl;
  }

  /** Set the task banner element reference. */
  setTaskBannerEl(el: HTMLDivElement | null): void {
    this.taskBannerEl = el;
  }

  /** Get the current task banner element. */
  getTaskBannerEl(): HTMLDivElement | null {
    return this.taskBannerEl;
  }

  /**
   * Ensure a task banner is shown at the top of the bubble.
   * Creates or re-creates the banner element.
   */
  ensureTaskBanner(bubbleEl: HTMLDivElement): void {
    if (!this.currentTask) return;

    // Remove existing banner
    if (this.taskBannerEl) this.taskBannerEl.remove();

    this.taskBannerEl = document.createElement('div');
    this.taskBannerEl.className = 'screensense-task-banner';
    this.taskBannerEl.textContent = this.currentTask;

    // Insert at the top
    if (bubbleEl.firstChild) {
      bubbleEl.insertBefore(this.taskBannerEl, bubbleEl.firstChild);
    } else {
      bubbleEl.appendChild(this.taskBannerEl);
    }
  }

  /**
   * Render the executing state: create step log container and replay history.
   * Returns the step log element (caller appends to bubble).
   */
  renderExecuting(bubbleEl: HTMLDivElement): HTMLDivElement {
    // Show task banner (user's question)
    this.ensureTaskBanner(bubbleEl);

    // Create the step log container
    if (!this.stepLogEl || !bubbleEl.contains(this.stepLogEl)) {
      this.stepLogEl = document.createElement('div');
      this.stepLogEl.className = 'screensense-step-log';
      bubbleEl.appendChild(this.stepLogEl);

      // Replay persistent history into the new DOM
      this.replayHistory();
    }

    return this.stepLogEl;
  }

  /** Add a step entry and record it in persistent history. */
  addStepEntry(text: string, type: StepStatus): void {
    // Record in persistent history
    const histType = type === 'active' ? 'step' : type === 'done' ? 'result' : type;
    this.chatHistory.push({ type: histType as ChatEntry['type'], text });

    this.renderStepEntryToLog(text, type);
  }

  /** Mark the last active step as done. */
  completeLastStep(): void {
    if (!this.stepLogEl) return;
    const lastActive = this.stepLogEl.querySelector('.screensense-step-icon.active');
    if (lastActive) {
      lastActive.classList.remove('active');
      lastActive.classList.add('done');
      lastActive.textContent = '\u2713';
    }
  }

  /**
   * Show a done summary with all completed steps.
   * Appends summary items to the bubble element.
   */
  showDoneSummary(bubbleEl: HTMLDivElement, steps?: string[]): void {
    const stepsToShow = steps || this.completedSteps;

    // Remove any existing summary
    const existing = bubbleEl.querySelector('.screensense-done-summary');
    if (existing) existing.remove();

    if (stepsToShow.length === 0) return;

    const summaryEl = document.createElement('div');
    summaryEl.className = 'screensense-done-summary';

    for (const step of stepsToShow) {
      const itemEl = document.createElement('div');
      itemEl.className = 'screensense-done-summary-item';

      const checkEl = document.createElement('span');
      checkEl.className = 'screensense-done-summary-check';
      checkEl.textContent = '\u2713';

      const textEl = document.createElement('span');
      textEl.textContent = step;

      itemEl.appendChild(checkEl);
      itemEl.appendChild(textEl);
      summaryEl.appendChild(itemEl);
    }

    bubbleEl.appendChild(summaryEl);
  }

  /** Reset DOM references during content area clear. */
  clearDomRefs(): void {
    this.taskBannerEl = null;
    this.stepLogEl = null;
  }

  /** Full cleanup — clear data and DOM references. */
  cleanup(): void {
    this.currentTask = '';
    this.completedSteps = [];
    this.taskBannerEl = null;
    this.stepLogEl = null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Replay chat history into the step log DOM. */
  private replayHistory(): void {
    if (!this.stepLogEl) return;
    for (const entry of this.chatHistory) {
      if (entry.type === 'question') {
        // Add a separator for each question in the history
        const sep = document.createElement('div');
        sep.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.4);font-style:italic;padding:6px 0 2px;border-top:0.5px solid rgba(255,255,255,0.06);margin-top:4px;';
        sep.textContent = `"${entry.text}"`;
        this.stepLogEl.appendChild(sep);
      } else {
        const typeMap: Record<string, StepStatus> = {
          step: 'done', // historical steps are all completed
          result: 'done',
          failed: 'failed',
          thinking: 'thinking',
          done: 'done',
        };
        this.renderStepEntryToLog(entry.text, typeMap[entry.type] || 'done');
      }
    }
    this.stepLogEl.scrollTop = this.stepLogEl.scrollHeight;
  }

  /** Render a single step entry into the step log DOM. */
  private renderStepEntryToLog(text: string, type: StepStatus): void {
    if (!this.stepLogEl) return;

    const entry = document.createElement('div');
    entry.className = 'screensense-step-entry';

    const icon = document.createElement('div');
    icon.className = `screensense-step-icon ${type}`;
    if (type === 'done') icon.textContent = '\u2713';
    else if (type === 'failed') icon.textContent = '\u2717';
    else if (type === 'active') icon.textContent = '\u25CB';
    else icon.textContent = '\u25CB';

    const textEl = document.createElement('span');
    textEl.className = `screensense-step-text ${type === 'done' ? 'result' : type === 'failed' ? 'failed' : type === 'thinking' ? 'thinking' : ''}`;
    textEl.textContent = text;

    entry.appendChild(icon);
    entry.appendChild(textEl);
    this.stepLogEl.appendChild(entry);

    // Auto-scroll to bottom
    this.stepLogEl.scrollTop = this.stepLogEl.scrollHeight;
  }
}
