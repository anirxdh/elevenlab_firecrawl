// ---------------------------------------------------------------------------
// Bubble state machine — state enum, transition logic, CSS class management
// Extracted from cursor-bubble.ts (pure refactor)
// ---------------------------------------------------------------------------

import { BubbleState } from '../shared/types';

/**
 * All CSS state classes applied to the bubble element.
 * Order matches the BubbleState union for easy iteration.
 */
const STATE_CLASSES = [
  'state-listening',
  'state-transcribing',
  'state-understanding',
  'state-planning',
  'state-executing',
  'state-answering',
  'state-error',
  'state-done',
] as const;

/** Callback fired when a state transition occurs. */
export type StateTransitionCallback = (
  newState: BubbleState,
  oldState: BubbleState,
  label?: string,
) => void;

/**
 * Manages the current `BubbleState` and keeps the bubble element's CSS
 * classes in sync.  Fires a callback on every transition so the container
 * can render the appropriate UI.
 */
export class BubbleStateMachine {
  private currentState: BubbleState = 'idle';
  private onTransition: StateTransitionCallback | null = null;

  /** Get the current state. */
  getState(): BubbleState {
    return this.currentState;
  }

  /** Register the transition callback (called *after* CSS classes are updated). */
  setTransitionCallback(cb: StateTransitionCallback): void {
    this.onTransition = cb;
  }

  /**
   * Transition to a new state.
   *
   * - Updates the internal state
   * - Swaps CSS classes on the bubble element (if provided)
   * - Fires the transition callback
   *
   * @returns `true` if the transition happened, `false` if `state` is 'idle'
   *          (caller should dismiss instead).
   */
  transition(state: BubbleState, bubbleEl: HTMLDivElement | null, label?: string): boolean {
    if (state === 'idle') {
      return false; // caller should dismiss
    }

    const oldState = this.currentState;
    this.currentState = state;

    // Swap CSS state classes on the bubble element
    if (bubbleEl) {
      for (const cls of STATE_CLASSES) {
        bubbleEl.classList.remove(cls);
      }
      bubbleEl.classList.add(`state-${state}`);
    }

    // Notify the container
    if (this.onTransition) {
      this.onTransition(state, oldState, label);
    }

    return true;
  }

  /** Reset to idle without firing the callback (used during cleanup). */
  reset(): void {
    this.currentState = 'idle';
  }

  /**
   * Whether the given state should cancel a pending auto-dismiss timer.
   * Error and done states manage their own timers, so they should not
   * cancel a previous one.
   */
  shouldCancelAutoDismiss(state: BubbleState): boolean {
    return state !== 'error' && state !== 'done';
  }
}
