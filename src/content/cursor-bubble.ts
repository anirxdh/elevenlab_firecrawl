import { renderMarkdown } from './markdown';
import { BubbleState, ConversationInfo, DisplayMode } from '../shared/types';
import { speak, stop as stopTts, isTtsEnabled, setTtsEnabled, isSpeaking } from './tts';
import { getSettings } from '../shared/storage';
import { BubbleStateMachine } from './bubble-state-machine';
import { WaveformRenderer } from './waveform-renderer';
import { ChatHistoryManager } from './chat-history';

// ---------------------------------------------------------------------------
// SVG icons
// ---------------------------------------------------------------------------

const WAVE_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="6" width="2" height="4" rx="1" fill="currentColor" opacity="0.7"><animate attributeName="height" values="4;8;4" dur="0.8s" repeatCount="indefinite"/><animate attributeName="y" values="6;4;6" dur="0.8s" repeatCount="indefinite"/></rect>
  <rect x="4.5" y="4" width="2" height="8" rx="1" fill="currentColor" opacity="0.85"><animate attributeName="height" values="8;12;8" dur="0.6s" repeatCount="indefinite"/><animate attributeName="y" values="4;2;4" dur="0.6s" repeatCount="indefinite"/></rect>
  <rect x="8" y="5" width="2" height="6" rx="1" fill="currentColor"><animate attributeName="height" values="6;10;6" dur="0.7s" repeatCount="indefinite"/><animate attributeName="y" values="5;3;5" dur="0.7s" repeatCount="indefinite"/></rect>
  <rect x="11.5" y="6" width="2" height="4" rx="1" fill="currentColor" opacity="0.7"><animate attributeName="height" values="4;7;4" dur="0.9s" repeatCount="indefinite"/><animate attributeName="y" values="6;4.5;6" dur="0.9s" repeatCount="indefinite"/></rect>
</svg>`;

const WAVE_ICON_STATIC = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="6" width="2" height="4" rx="1" fill="currentColor" opacity="0.4"/>
  <rect x="4.5" y="4" width="2" height="8" rx="1" fill="currentColor" opacity="0.4"/>
  <rect x="8" y="5" width="2" height="6" rx="1" fill="currentColor" opacity="0.4"/>
  <rect x="11.5" y="6" width="2" height="4" rx="1" fill="currentColor" opacity="0.4"/>
</svg>`;

// ---------------------------------------------------------------------------
// Inline styles (Shadow DOM — no external CSS file)
// ---------------------------------------------------------------------------

const BUBBLE_STYLES = `
/* ─── Host bubble — Apple frosted glass ─── */
.screensense-bubble {
  position: fixed;
  z-index: 2147483647;
  padding: 8px 14px;
  border-radius: 20px;
  background: rgba(20, 20, 22, 0.65);
  backdrop-filter: blur(50px) saturate(1.8);
  -webkit-backdrop-filter: blur(50px) saturate(1.8);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.95);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  pointer-events: none;
  user-select: text;
  opacity: 0;
  transform: scale(0.96) translateY(4px);
  transition: opacity 0.25s cubic-bezier(0.2, 0, 0, 1),
              transform 0.25s cubic-bezier(0.2, 0, 0, 1),
              width 0.3s cubic-bezier(0.2, 0, 0, 1),
              padding 0.3s cubic-bezier(0.2, 0, 0, 1),
              border-radius 0.3s cubic-bezier(0.2, 0, 0, 1),
              box-shadow 0.3s ease;
  width: 180px; /* listening pill — overridden by state classes */
  box-sizing: border-box;
  box-shadow:
    0 0 0 0.5px rgba(255, 255, 255, 0.06),
    0 12px 48px rgba(0, 0, 0, 0.5),
    0 4px 16px rgba(0, 0, 0, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    inset 0 -1px 0 rgba(255, 255, 255, 0.03);
}

.screensense-bubble.visible {
  opacity: 1;
  transform: scale(1) translateY(0);
}

.screensense-bubble.fade-out {
  opacity: 0;
  transform: scale(0.96) translateY(4px);
}

/* Expanded width for answering state */
.screensense-bubble.state-answering {
  width: 444px;
  max-height: 500px;
  padding: 20px 24px;
  border-radius: 18px;
  overflow-y: auto;
  pointer-events: auto;
}

.screensense-bubble.state-transcribing,
.screensense-bubble.state-planning {
  width: 320px;
  padding: 14px 16px;
  border-radius: 16px;
}

/* ─── Status states ─── */
.screensense-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 400;
}

.screensense-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.65);
  flex-shrink: 0;
  animation: apple-pulse 1.5s ease-in-out infinite;
}

/* ─── Listening waveform ─── */
.screensense-waveform {
  display: flex;
  align-items: center;
  gap: 2.5px;
  height: 20px;
  justify-content: center;
  padding: 0;
}

.screensense-waveform .wave-bar {
  width: 2.5px;
  min-height: 2px;
  max-height: 18px;
  height: 2px;
  background: rgba(255, 255, 255, 0.65);
  border-radius: 1.5px;
  transition: height 0.06s cubic-bezier(0.2, 0, 0, 1);
}

/* ─── Executing step indicator ─── */
/* ─── Chat-style step log ─── */
.screensense-step-log {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 300px;
  overflow-y: auto;
  padding-right: 4px;
}

.screensense-step-log::-webkit-scrollbar { width: 3px; }
.screensense-step-log::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }

.screensense-step-entry {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  line-height: 1.4;
  padding: 3px 0;
}

.screensense-step-icon {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  border-radius: 50%;
  margin-top: 2px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.4);
}

.screensense-step-icon.done {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.5);
}

.screensense-step-icon.active {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
  animation: step-pulse 1.2s ease-in-out infinite;
}

.screensense-step-icon.failed {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.35);
}

.screensense-step-icon.thinking {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.45);
  animation: step-pulse 1.5s ease-in-out infinite;
}

@keyframes step-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.screensense-step-text {
  color: rgba(255, 255, 255, 0.55);
  word-break: break-word;
}

.screensense-step-text.result {
  color: rgba(255, 255, 255, 0.75);
}

.screensense-step-text.failed {
  color: rgba(255, 255, 255, 0.45);
  font-style: italic;
}

.screensense-step-text.thinking {
  color: rgba(255, 255, 255, 0.4);
  font-style: italic;
}

/* Fixed width for all non-listening states */
.screensense-bubble.state-executing,
.screensense-bubble.state-understanding,
.screensense-bubble.state-error,
.screensense-bubble.state-done {
  width: 320px;
  max-height: 420px;
  padding: 14px 16px;
  border-radius: 16px;
  overflow-y: auto;
  pointer-events: auto;
}

/* No pulsing borders — keep neutral */

.screensense-reasoning {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.45);
  font-style: italic;
  margin-bottom: 6px;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 6px;
  border-left: 2px solid rgba(255, 255, 255, 0.4);
  line-height: 1.4;
}

/* ─── Task banner (persistent question display) ─── */
.screensense-task-banner {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  font-style: italic;
  margin-bottom: 6px;
  padding-bottom: 5px;
  border-bottom: 0.5px solid rgba(255, 255, 255, 0.08);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ─── Done summary (list of completed steps) ─── */
.screensense-done-summary {
  margin-top: 6px;
}

.screensense-done-summary-item {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  margin: 2px 0;
  display: flex;
  gap: 5px;
}

.screensense-done-summary-check {
  color: rgba(255, 255, 255, 0.4);
  flex-shrink: 0;
  font-size: 10px;
}

/* ─── Answering: response area ─── */
.screensense-response strong {
  font-weight: 600;
  color: #fff;
}

.screensense-response code {
  background: rgba(255, 255, 255, 0.08);
  border: 0.5px solid rgba(255, 255, 255, 0.1);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: 'SF Mono', Menlo, Monaco, monospace;
  font-size: 12.5px;
}

.screensense-response ul {
  margin: 4px 0;
  padding-left: 18px;
}

.screensense-response li {
  margin: 2px 0;
}

/* ─── Chat history ─── */
.screensense-history {
  display: none;
  margin-bottom: 10px;
}

.screensense-history.visible {
  display: block;
}

.screensense-history-turn {
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 0.5px solid rgba(255, 255, 255, 0.06);
}

.screensense-history-q {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.35);
  font-style: italic;
  margin-bottom: 3px;
}

.screensense-history-a {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.45);
}

.screensense-history-a strong {
  font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
}

.screensense-history-a code {
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 12px;
}

.screensense-history-a ul {
  margin: 2px 0;
  padding-left: 16px;
}

.screensense-history-a li {
  margin: 1px 0;
}

/* ─── Transcript ─── */
.screensense-transcript {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.35);
  margin-bottom: 10px;
  font-style: italic;
  border-bottom: 0.5px solid rgba(255, 255, 255, 0.06);
  padding-bottom: 8px;
  display: none;
}

.screensense-transcript.visible {
  display: block;
}

/* ─── Error state ─── */
.screensense-error {
  color: rgba(255, 69, 58, 0.95);
  font-size: 13px;
}

/* ─── Done state ─── */
.screensense-done {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.95);
}

.screensense-done-check {
  font-size: 15px;
}

/* ─── Follow-up input ─── */
.screensense-followup {
  display: none;
  margin-top: 12px;
  border-top: 0.5px solid rgba(255, 255, 255, 0.06);
  padding-top: 10px;
}

.screensense-followup.visible {
  display: block;
}

.screensense-followup-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.screensense-followup-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  border: 0.5px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.92);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
  outline: none;
  transition: border-color 0.2s ease, background 0.2s ease;
}

.screensense-followup-input::placeholder {
  color: rgba(255, 255, 255, 0.2);
}

.screensense-followup-input:focus {
  border-color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.08);
}

.screensense-followup-send {
  background: rgba(255, 255, 255, 0.2);
  border: 0.5px solid rgba(255, 255, 255, 0.3);
  border-radius: 8px;
  padding: 6px 12px;
  color: rgba(255, 255, 255, 0.95);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.screensense-followup-send:hover {
  background: rgba(255, 255, 255, 0.3);
}

/* ─── Context bar ─── */
.screensense-context-bar {
  display: none;
  margin-top: 8px;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.25);
}

.screensense-context-bar.visible {
  display: flex;
}

.screensense-context-track {
  flex: 1;
  height: 2px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 1px;
  overflow: hidden;
}

.screensense-context-fill {
  height: 100%;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 1px;
  transition: width 0.3s ease;
}

.screensense-context-label {
  white-space: nowrap;
  min-width: 28px;
  text-align: right;
}

.screensense-clear-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.25);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.screensense-clear-btn:hover {
  color: rgba(255, 69, 58, 0.7);
  background: rgba(255, 69, 58, 0.08);
}

.screensense-tts-btn {
  background: none;
  border: 0.5px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.25);
  cursor: pointer;
  padding: 3px 5px;
  border-radius: 5px;
  transition: all 0.15s ease;
  line-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.screensense-tts-btn.active {
  color: rgba(255, 255, 255, 0.9);
  border-color: rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.08);
}

.screensense-tts-btn:hover {
  color: rgba(255, 255, 255, 0.8);
  border-color: rgba(255, 255, 255, 0.3);
}

/* ─── Audio-only speaking waveform ─── */
.screensense-speaking-wave {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 8px 0;
}

.screensense-speaking-wave .wave-bar {
  width: 3.5px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.7);
  animation: apple-wave-bar 1.3s ease-in-out infinite;
}

.screensense-speaking-wave .wave-bar:nth-child(1)  { height: 8px;  animation-delay: 0s; }
.screensense-speaking-wave .wave-bar:nth-child(2)  { height: 14px; animation-delay: 0.08s; }
.screensense-speaking-wave .wave-bar:nth-child(3)  { height: 20px; animation-delay: 0.12s; }
.screensense-speaking-wave .wave-bar:nth-child(4)  { height: 26px; animation-delay: 0.16s; }
.screensense-speaking-wave .wave-bar:nth-child(5)  { height: 32px; animation-delay: 0.2s; }
.screensense-speaking-wave .wave-bar:nth-child(6)  { height: 28px; animation-delay: 0.24s; }
.screensense-speaking-wave .wave-bar:nth-child(7)  { height: 34px; animation-delay: 0.28s; }
.screensense-speaking-wave .wave-bar:nth-child(8)  { height: 24px; animation-delay: 0.32s; }
.screensense-speaking-wave .wave-bar:nth-child(9)  { height: 30px; animation-delay: 0.36s; }
.screensense-speaking-wave .wave-bar:nth-child(10) { height: 20px; animation-delay: 0.4s; }
.screensense-speaking-wave .wave-bar:nth-child(11) { height: 26px; animation-delay: 0.44s; }
.screensense-speaking-wave .wave-bar:nth-child(12) { height: 16px; animation-delay: 0.48s; }
.screensense-speaking-wave .wave-bar:nth-child(13) { height: 10px; animation-delay: 0.52s; }

.screensense-speaking-label {
  text-align: center;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 4px;
  letter-spacing: 0.02em;
}

/* ─── Drag handle ─── */
.screensense-drag-handle {
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.2);
  margin: 0 auto 8px auto;
  cursor: grab;
  transition: background 0.15s ease;
}

.screensense-drag-handle:hover {
  background: rgba(255, 255, 255, 0.4);
}

.screensense-drag-handle:active {
  cursor: grabbing;
  background: rgba(255, 255, 255, 0.5);
}

/* ─── Scrollbar styling ─── */
.screensense-bubble::-webkit-scrollbar {
  width: 4px;
}

.screensense-bubble::-webkit-scrollbar-track {
  background: transparent;
}

.screensense-bubble::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
}

.screensense-bubble::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* ─── Keyframe animations ─── */
@keyframes apple-pulse {
  0%, 100% {
    opacity: 0.35;
    transform: scale(0.9);
  }
  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}

@keyframes apple-wave-bar {
  0%, 100% { transform: scaleY(0.35); opacity: 0.4; }
  50%      { transform: scaleY(1);    opacity: 0.9; }
}
`;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURSOR_OFFSET_Y = 20;
const BUBBLE_WIDTH_PILL = 180;   // listening state only
const BUBBLE_WIDTH_STATUS = 320; // all other states
const BUBBLE_WIDTH_ANSWER = 444;
const BUBBLE_MAX_HEIGHT_ANSWER = 500;

// ---------------------------------------------------------------------------
// CursorBubble class — container that composes state machine, waveform,
// and chat history modules.
// ---------------------------------------------------------------------------

export class CursorBubble {
  private container: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private bubbleEl: HTMLDivElement | null = null;

  // Sub-elements built per state
  private historyEl: HTMLDivElement | null = null;
  private transcriptEl: HTMLDivElement | null = null;
  private responseEl: HTMLDivElement | null = null;
  private followupEl: HTMLDivElement | null = null;
  private followupInput: HTMLInputElement | null = null;
  private contextBar: HTMLDivElement | null = null;
  private contextFill: HTMLDivElement | null = null;
  private contextLabel: HTMLSpanElement | null = null;
  private ttsBtn: HTMLButtonElement | null = null;

  // Composed modules
  private stateMachine = new BubbleStateMachine();
  private waveform = new WaveformRenderer();
  private chatHistory = new ChatHistoryManager();

  // Visibility & tracking
  private visible = false;
  private tracking = false;

  // Accumulated content (answer streaming)
  private accumulatedText = '';
  private currentTranscript = '';

  // Timers
  private autoDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;
  private ttsPollTimer: ReturnType<typeof setInterval> | null = null;

  // Event handlers (stored for removal)
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;

  // Drag state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragBubbleStartX = 0;
  private dragBubbleStartY = 0;
  private dragMoveHandler: ((e: MouseEvent) => void) | null = null;
  private dragUpHandler: ((e: MouseEvent) => void) | null = null;
  private dragHandle: HTMLDivElement | null = null;

  // Callbacks registered by content script
  private onFollowUp: ((text: string) => void) | null = null;
  private onClear: (() => void) | null = null;

  // Display mode
  private displayMode: DisplayMode = 'both';

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Register callbacks for follow-up input and conversation clear. */
  setCallbacks(onFollowUp: (text: string) => void, onClear: () => void): void {
    this.onFollowUp = onFollowUp;
    this.onClear = onClear;
  }

  /**
   * Create the Shadow DOM host, attach to document.body, and start mouse tracking.
   * Call setState() immediately after to set the initial state.
   */
  show(cursorX: number, cursorY: number): void {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    if (this.visible) {
      this.dismissImmediate();
    }

    // Read display mode asynchronously (non-blocking)
    getSettings().then(settings => {
      this.displayMode = settings.displayMode;
    });

    // Host container: fixed, zero-size, max z-index, pointer-events none
    this.container = document.createElement('div');
    this.container.id = 'screensense-bubble-host';
    this.container.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';

    // Closed Shadow DOM for style isolation
    this.shadowRoot = this.container.attachShadow({ mode: 'closed' });

    const styleEl = document.createElement('style');
    styleEl.textContent = BUBBLE_STYLES;
    this.shadowRoot.appendChild(styleEl);

    // Bubble element
    this.bubbleEl = document.createElement('div');
    this.bubbleEl.className = 'screensense-bubble';
    this.positionBubble(cursorX, cursorY, BUBBLE_WIDTH_PILL);

    this.shadowRoot.appendChild(this.bubbleEl);
    document.body.appendChild(this.container);

    // Entrance animation
    requestAnimationFrame(() => {
      if (this.bubbleEl) {
        this.bubbleEl.classList.add('visible');
      }
    });

    // Escape key handler (capture phase)
    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (this.shadowRoot?.activeElement === this.followupInput) return;
        e.preventDefault();
        e.stopPropagation();
        this.dismiss();
      }
    };
    document.addEventListener('keydown', this.escapeHandler, true);

    this.startTracking();
    this.visible = true;
    this.waveform.resetLogCount();
  }

  /**
   * Transition bubble to a new state.
   * Clears previous state content and renders the new state.
   * If state is 'idle', calls dismiss().
   */
  setState(state: BubbleState, label?: string): void {
    if (state === 'idle') {
      this.dismiss();
      return;
    }

    if (!this.bubbleEl) return;

    // Store the transcript when it arrives with the 'understanding' state
    if (state === 'understanding' && label) {
      this.currentTranscript = label;
    }

    // Cancel any pending auto-dismiss from a previous state (unless we're in a state that sets its own)
    if (this.stateMachine.shouldCancelAutoDismiss(state)) {
      this.clearAutoDismiss();
    }

    // Transition the state machine (updates CSS classes on bubbleEl)
    this.stateMachine.transition(state, this.bubbleEl, label);

    // Re-render content area for the new state
    if (state === 'answering') {
      this.renderAnsweringState();
    } else if (state === 'understanding' && this.chatHistory.getStepLogEl() && this.bubbleEl?.contains(this.chatHistory.getStepLogEl())) {
      // Preserve step log during re-evaluation — just add a "thinking" entry
      this.chatHistory.completeLastStep();
      this.chatHistory.addStepEntry(label || 'Re-evaluating...', 'thinking');
    } else if (state === 'executing' && this.chatHistory.getStepLogEl() && this.bubbleEl?.contains(this.chatHistory.getStepLogEl())) {
      // Preserve step log when transitioning back to executing
      // Remove the last "thinking" entry if present
      const stepLogEl = this.chatHistory.getStepLogEl();
      if (stepLogEl) {
        const lastThinking = stepLogEl.querySelector('.screensense-step-icon.thinking');
        if (lastThinking) lastThinking.parentElement?.remove();
      }
    } else {
      this.clearContentArea();
      this.renderState(state, label);
    }
  }

  /**
   * Update waveform bar heights from microphone frequency data.
   * Only meaningful in 'listening' state.
   */
  updateAmplitude(frequencyData: Uint8Array): void {
    if (this.stateMachine.getState() !== 'listening') {
      return;
    }
    this.waveform.updateAmplitude(frequencyData);
  }

  /**
   * Update step display during 'executing' state.
   */
  setStep(name: string, index: number, total: number): void {
    if (!this.bubbleEl) return;

    if (this.stateMachine.getState() !== 'executing') {
      this.setState('executing');
    }

    // Determine if this is a result (action completed) or intent (about to do)
    const isResult = /^(Clicked|Typed|Navigat|Scrolled|Extracted)/.test(name);
    const isFailed = /^Failed:/.test(name);
    const isRetrying = /^Retrying:/.test(name);

    if (isResult) {
      // Complete the previous "active" step and add result
      this.chatHistory.completeLastStep();
      this.addCompletedStep(name);
    } else if (isFailed) {
      // Mark previous as failed, add failure entry
      const stepLogEl = this.chatHistory.getStepLogEl();
      if (stepLogEl) {
        const lastActive = stepLogEl.querySelector('.screensense-step-icon.active');
        if (lastActive) {
          lastActive.classList.remove('active');
          lastActive.classList.add('failed');
          lastActive.textContent = '\u2717';
        }
      }
      this.chatHistory.addStepEntry(name, 'failed');
    } else if (!isRetrying) {
      // New action intent — add as active
      this.chatHistory.completeLastStep(); // complete any prior active step
      this.chatHistory.addStepEntry(name, 'active');
    }
  }

  /**
   * Append a streaming text chunk (answering state).
   * Automatically transitions to 'answering' if not already in that state.
   */
  appendChunk(text: string): void {
    if (!this.responseEl) {
      // Transition to answering if not already
      if (this.stateMachine.getState() !== 'answering') {
        this.setState('answering');
      }
    }

    if (!this.responseEl) return;

    // Lock position once content starts streaming
    if (!this.accumulatedText && this.tracking) {
      this.stopTracking();
    }

    this.accumulatedText += text;

    // In audio-only mode, don't render text
    if (this.displayMode === 'audio-only') return;

    this.responseEl.innerHTML = renderMarkdown(this.accumulatedText);

    // Auto-scroll to bottom
    if (this.bubbleEl) {
      const el = this.bubbleEl;
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      if (isNearBottom) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }

  /**
   * Signal that answer streaming is complete.
   * Shows follow-up input (unless audio-only) and optionally shows speaking waveform.
   */
  onAnswerDone(): void {
    if (this.displayMode === 'audio-only') {
      // Show speaking waveform instead of text
      if (this.responseEl) {
        const bars = Array.from({ length: 13 }, () => '<div class="wave-bar"></div>').join('');
        this.responseEl.innerHTML =
          `<div class="screensense-speaking-wave">${bars}</div>` +
          `<div class="screensense-speaking-label">Preparing audio...</div>`;
      }
      if (this.transcriptEl) this.transcriptEl.style.display = 'none';
      if (this.historyEl) this.historyEl.style.display = 'none';
      return;
    }

    if (this.followupEl) {
      this.followupEl.classList.add('visible');
    }
    if (this.contextBar) {
      this.contextBar.classList.add('visible');
    }
  }

  /**
   * Trigger TTS for the answer summary.
   * In audio-only mode, shows speaking waveform and auto-dismisses when TTS finishes.
   */
  speakSummary(summary: string): void {
    console.log('[ScreenSense][bubble] speakSummary called, displayMode:', this.displayMode, 'summary:', summary);
    if (this.displayMode === 'text-only') return;
    speak(summary);

    if (this.displayMode === 'audio-only') {
      if (this.responseEl) {
        const label = this.responseEl.querySelector('.screensense-speaking-label');
        if (label) label.textContent = 'Speaking...';
      }

      this.ttsPollTimer = setInterval(() => {
        if (!isSpeaking()) {
          if (this.ttsPollTimer) {
            clearInterval(this.ttsPollTimer);
            this.ttsPollTimer = null;
          }
          this.dismiss();
        }
      }, 500);
    }
  }

  /** Show an error message and auto-dismiss after 5 seconds. */
  showError(error: string): void {
    this.setState('error', error);
    this.autoDismissTimer = setTimeout(() => {
      this.dismiss();
    }, 5000);
  }

  /** Fade out and remove from DOM. Stops mouse tracking and clears all timers. */
  dismiss(): void {
    if (!this.visible || !this.bubbleEl) {
      this.cleanup();
      return;
    }

    this.bubbleEl.classList.add('fade-out');
    this.bubbleEl.classList.remove('visible');

    this.dismissTimer = setTimeout(() => {
      this.dismissTimer = null;
      this.cleanup();
    }, 180);

    this.visible = false;
  }

  /** Returns whether the bubble is currently shown. */
  isVisible(): boolean {
    return this.visible;
  }

  /** Temporarily hide for screenshot capture (no animation). */
  hideForScreenshot(): void {
    if (this.container) {
      this.container.style.display = 'none';
    }
  }

  /** Re-show after screenshot capture. */
  showAfterScreenshot(): void {
    if (this.container) {
      this.container.style.display = '';
    }
  }

  /** Update context bar turns indicator. */
  updateConversationInfo(info: ConversationInfo): void {
    const pct = info.maxTurns > 0 ? Math.round((info.turns / info.maxTurns) * 100) : 0;
    if (this.contextFill) {
      this.contextFill.style.width = `${pct}%`;
    }
    if (this.contextLabel) {
      this.contextLabel.textContent = `${pct}%`;
    }
  }

  /**
   * Move current Q&A into history, clear response area, restart mouse tracking.
   * Called before a follow-up question is processed.
   */
  prepareForFollowUp(): void {
    stopTts();
    this.startTracking();

    // Move current Q&A into history
    if (this.accumulatedText && this.historyEl) {
      const turnEl = document.createElement('div');
      turnEl.className = 'screensense-history-turn';

      if (this.currentTranscript) {
        const qEl = document.createElement('div');
        qEl.className = 'screensense-history-q';
        qEl.textContent = `"${this.currentTranscript}"`;
        turnEl.appendChild(qEl);
      }

      const aEl = document.createElement('div');
      aEl.className = 'screensense-history-a';
      aEl.innerHTML = renderMarkdown(this.accumulatedText);
      turnEl.appendChild(aEl);

      this.historyEl.appendChild(turnEl);
      this.historyEl.classList.add('visible');
    }

    // Hide follow-up input during processing
    if (this.followupEl) {
      this.followupEl.classList.remove('visible');
    }

    // Clear response state
    this.accumulatedText = '';
    this.currentTranscript = '';
    if (this.responseEl) {
      this.responseEl.innerHTML = '';
    }
    if (this.transcriptEl) {
      this.transcriptEl.textContent = '';
      this.transcriptEl.classList.remove('visible');
    }
  }

  /**
   * Display Nova's reasoning text in the bubble before showing action steps.
   * Inserts a styled reasoning element at the top of the bubble content.
   */
  /** Set the current task text — shown persistently in the bubble */
  setTask(task: string): void {
    this.chatHistory.setTask(task);
  }

  /** Clear the persistent chat history */
  clearChatHistory(): void {
    this.chatHistory.clearHistory();
  }

  /** Show a done summary with all completed steps */
  showDoneSummary(steps: string[]): void {
    if (!this.bubbleEl) return;
    this.chatHistory.showDoneSummary(this.bubbleEl, steps);
  }

  /** Track a completed step for the done summary */
  addCompletedStep(step: string): void {
    this.chatHistory.addCompletedStep(step);
  }

  showReasoning(text: string): void {
    if (!this.bubbleEl) return;

    // Add reasoning as a "thinking" entry in the step log
    if (this.chatHistory.getStepLogEl()) {
      this.chatHistory.completeLastStep();
      this.chatHistory.addStepEntry(text, 'thinking');
    }
  }

  // ---------------------------------------------------------------------------
  // Private: state rendering
  // ---------------------------------------------------------------------------

  private renderState(state: BubbleState, label?: string): void {
    if (!this.bubbleEl) return;

    switch (state) {
      case 'listening':
        this.renderListening();
        break;
      case 'transcribing':
        this.renderStatus('Transcribing...');
        break;
      case 'understanding':
        this.renderStatus('Understanding...');
        break;
      case 'planning':
        this.renderStatus('Planning...');
        break;
      case 'executing':
        this.renderExecuting(label);
        break;
      case 'error':
        this.renderError(label ?? 'An error occurred');
        break;
      case 'done':
        this.renderDone();
        break;
    }
  }

  private renderListening(): void {
    if (!this.bubbleEl) return;

    const waveformEl = this.waveform.createWaveform();
    this.bubbleEl.appendChild(waveformEl);
  }

  private renderStatus(text: string): void {
    if (!this.bubbleEl) return;

    // Show task banner during processing states
    this.chatHistory.ensureTaskBanner(this.bubbleEl);

    const statusEl = document.createElement('div');
    statusEl.className = 'screensense-status';

    const dotEl = document.createElement('div');
    dotEl.className = 'screensense-status-dot';

    const textEl = document.createElement('span');
    textEl.textContent = text;

    statusEl.appendChild(dotEl);
    statusEl.appendChild(textEl);
    this.bubbleEl.appendChild(statusEl);
  }

  private renderExecuting(label?: string): void {
    if (!this.bubbleEl) return;
    this.chatHistory.renderExecuting(this.bubbleEl);
  }

  private renderError(error: string): void {
    if (!this.bubbleEl) return;

    const errorEl = document.createElement('div');
    errorEl.className = 'screensense-error';
    errorEl.textContent = error;
    this.bubbleEl.appendChild(errorEl);
  }

  private renderDone(): void {
    if (!this.bubbleEl) return;

    // Show task banner if present
    this.chatHistory.ensureTaskBanner(this.bubbleEl);

    const doneEl = document.createElement('div');
    doneEl.className = 'screensense-done';

    const checkEl = document.createElement('span');
    checkEl.className = 'screensense-done-check';
    checkEl.textContent = '\u2713';

    const textEl = document.createElement('span');
    textEl.textContent = 'Done';

    doneEl.appendChild(checkEl);
    doneEl.appendChild(textEl);
    this.bubbleEl.appendChild(doneEl);

    // Show completed steps summary if we have any
    const completedSteps = this.chatHistory.getCompletedSteps();
    if (completedSteps.length > 0) {
      this.chatHistory.showDoneSummary(this.bubbleEl);
    }

    // Auto-dismiss after longer if we have a summary to show
    const dismissDelay = completedSteps.length > 0 ? 5000 : 2000;
    this.autoDismissTimer = setTimeout(() => {
      this.dismiss();
    }, dismissDelay);
  }

  private renderAnsweringState(): void {
    if (!this.bubbleEl) return;

    // Expand to full answer width (override inline style from positionBubble)
    this.bubbleEl.style.width = `${BUBBLE_WIDTH_ANSWER}px`;
    this.bubbleEl.style.padding = '20px 24px';
    this.bubbleEl.style.borderRadius = '18px';

    // Clear non-persistent content (not history)
    if (this.historyEl) {
      // Keep history — remove everything else
      const children = Array.from(this.bubbleEl.childNodes);
      for (const child of children) {
        if (child !== this.historyEl) {
          this.bubbleEl.removeChild(child);
        }
      }
    } else {
      this.bubbleEl.innerHTML = '';
    }

    // Adjust bubble width for answer content
    this.bubbleEl.style.maxHeight = `${BUBBLE_MAX_HEIGHT_ANSWER}px`;

    // Drag handle at the top of the bubble
    this.dragHandle = document.createElement('div');
    this.dragHandle.className = 'screensense-drag-handle';
    this.dragHandle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.startDrag(e);
    });
    this.bubbleEl.appendChild(this.dragHandle);

    // Build history container (if not already present)
    if (!this.historyEl) {
      this.historyEl = document.createElement('div');
      this.historyEl.className = 'screensense-history';
      this.bubbleEl.appendChild(this.historyEl);
    }

    // Transcript (current user question)
    this.transcriptEl = document.createElement('div');
    this.transcriptEl.className = 'screensense-transcript';
    if (this.currentTranscript) {
      this.transcriptEl.textContent = `"${this.currentTranscript}"`;
      this.transcriptEl.classList.add('visible');
    }
    this.bubbleEl.appendChild(this.transcriptEl);

    // Response area
    this.responseEl = document.createElement('div');
    this.responseEl.className = 'screensense-response';
    if (this.accumulatedText) {
      this.responseEl.innerHTML = renderMarkdown(this.accumulatedText);
    }
    this.bubbleEl.appendChild(this.responseEl);

    // Follow-up and context bar removed for cleaner UI
  }

  // ---------------------------------------------------------------------------
  // Private: helpers
  // ---------------------------------------------------------------------------

  private clearContentArea(): void {
    if (!this.bubbleEl) return;
    this.bubbleEl.innerHTML = '';
    this.bubbleEl.style.maxHeight = '';
    // Reset to pill size (inline overrides from answering state)
    this.bubbleEl.style.width = '';
    this.bubbleEl.style.padding = '';
    this.bubbleEl.style.borderRadius = '';
    this.waveform.cleanup();

    // Reset sub-element refs
    this.historyEl = null;
    this.transcriptEl = null;
    this.responseEl = null;
    this.followupEl = null;
    this.followupInput = null;
    this.contextBar = null;
    this.contextFill = null;
    this.contextLabel = null;
    this.ttsBtn = null;
    this.dragHandle = null;
    this.chatHistory.clearDomRefs();
  }

  private sendFollowUp(): void {
    if (!this.followupInput) return;
    const text = this.followupInput.value.trim();
    if (!text) return;

    this.followupInput.value = '';
    this.clearAutoDismiss();

    this.prepareForFollowUp();

    if (this.onFollowUp) {
      this.onFollowUp(text);
    }
  }

  private clearAutoDismiss(): void {
    if (this.autoDismissTimer) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }
  }

  private startTracking(): void {
    if (this.tracking) return;
    this.tracking = true;
    this.mouseMoveHandler = (e: MouseEvent) => {
      const width = this.stateMachine.getState() === 'answering' ? BUBBLE_WIDTH_ANSWER : BUBBLE_WIDTH_STATUS;
      this.positionBubble(e.clientX, e.clientY, width);
    };
    document.addEventListener('mousemove', this.mouseMoveHandler, { passive: true });
  }

  private stopTracking(): void {
    if (!this.tracking) return;
    this.tracking = false;
    if (this.mouseMoveHandler) {
      document.removeEventListener('mousemove', this.mouseMoveHandler);
      this.mouseMoveHandler = null;
    }
  }

  /**
   * Position the bubble near the cursor with edge detection.
   * Reuses the same logic as overlay.ts positionOverlay().
   */
  private positionBubble(cursorX: number, cursorY: number, bubbleWidth: number): void {
    if (!this.bubbleEl) return;

    const bubbleMaxHeight = this.stateMachine.getState() === 'answering' ? BUBBLE_MAX_HEIGHT_ANSWER : 120;
    const offset = CURSOR_OFFSET_Y;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Calculate pixel position, accounting for centering / flipping so we
    // never need to put translateX/Y into the inline transform — that keeps
    // the CSS-class entrance animation (scale + translateY) working.
    let left: number;
    if (cursorX < bubbleWidth / 2 + 10) {
      left = Math.max(10, cursorX);
    } else if (cursorX > vw - bubbleWidth / 2 - 10) {
      left = Math.min(vw - 10, cursorX) - bubbleWidth;
    } else {
      left = cursorX - bubbleWidth / 2;
    }

    let top: number;
    if (cursorY + offset + bubbleMaxHeight > vh) {
      // Flip above cursor — estimate actual bubble height as min(content, max)
      const estimatedHeight = Math.min(
        this.bubbleEl.offsetHeight || 60,
        bubbleMaxHeight
      );
      top = cursorY - offset - estimatedHeight;
    } else {
      top = cursorY + offset;
    }

    this.bubbleEl.style.left = `${left}px`;
    this.bubbleEl.style.top = `${top}px`;
    this.bubbleEl.style.width = `${bubbleWidth}px`;
    // Do NOT set inline transform — let the CSS classes handle scale/translateY
    // for entrance and exit animations.
  }

  private startDrag(e: MouseEvent): void {
    if (!this.bubbleEl || this.stateMachine.getState() !== 'answering') return;

    this.isDragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragBubbleStartX = parseInt(this.bubbleEl.style.left || '0', 10);
    this.dragBubbleStartY = parseInt(this.bubbleEl.style.top || '0', 10);

    this.dragMoveHandler = (ev: MouseEvent) => {
      if (!this.isDragging || !this.bubbleEl) return;
      const dx = ev.clientX - this.dragStartX;
      const dy = ev.clientY - this.dragStartY;
      this.bubbleEl.style.left = `${this.dragBubbleStartX + dx}px`;
      this.bubbleEl.style.top = `${this.dragBubbleStartY + dy}px`;
    };

    this.dragUpHandler = () => {
      this.isDragging = false;
      if (this.dragMoveHandler) {
        document.removeEventListener('mousemove', this.dragMoveHandler);
        this.dragMoveHandler = null;
      }
      if (this.dragUpHandler) {
        document.removeEventListener('mouseup', this.dragUpHandler);
        this.dragUpHandler = null;
      }
    };

    document.addEventListener('mousemove', this.dragMoveHandler);
    document.addEventListener('mouseup', this.dragUpHandler);
  }

  private stopDrag(): void {
    this.isDragging = false;
    if (this.dragMoveHandler) {
      document.removeEventListener('mousemove', this.dragMoveHandler);
      this.dragMoveHandler = null;
    }
    if (this.dragUpHandler) {
      document.removeEventListener('mouseup', this.dragUpHandler);
      this.dragUpHandler = null;
    }
  }

  private dismissImmediate(): void {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    this.cleanup();
    this.visible = false;
  }

  private cleanup(): void {
    stopTts();
    this.stopTracking();
    this.stopDrag();

    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }

    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler, true);
      this.escapeHandler = null;
    }

    this.clearAutoDismiss();

    if (this.ttsPollTimer) {
      clearInterval(this.ttsPollTimer);
      this.ttsPollTimer = null;
    }

    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    this.container = null;
    this.shadowRoot = null;
    this.bubbleEl = null;
    this.historyEl = null;
    this.transcriptEl = null;
    this.responseEl = null;
    this.followupEl = null;
    this.followupInput = null;
    this.contextBar = null;
    this.contextFill = null;
    this.contextLabel = null;
    this.ttsBtn = null;
    this.dragHandle = null;
    this.waveform.cleanup();
    this.accumulatedText = '';
    this.currentTranscript = '';
    this.chatHistory.cleanup();
    this.stateMachine.reset();
  }
}
