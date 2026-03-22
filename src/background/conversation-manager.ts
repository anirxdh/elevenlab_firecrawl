// src/background/conversation-manager.ts
import { MAX_CONVERSATION_TURNS } from '../shared/constants';

export enum ConversationState {
  Idle = 'idle',
  Listening = 'listening',
  Processing = 'processing',
  Speaking = 'speaking',
  AwaitingReply = 'awaiting_reply',
  Executing = 'executing',
}

export interface ConversationTurn {
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
}

const IDLE_TIMEOUT_MS = 30_000;

export class ConversationManager {
  private state: ConversationState = ConversationState.Idle;
  private sessions = new Map<number, ConversationTurn[]>();
  private activeTabId: number | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onIdleCallback: (() => void) | null = null;

  getState(): ConversationState { return this.state; }

  transition(newState: ConversationState): void {
    this.state = newState;
    if (newState !== ConversationState.Idle) this.resetIdleTimer();
  }

  onIdle(cb: () => void): void { this.onIdleCallback = cb; }

  startSession(tabId: number): void {
    this.activeTabId = tabId;
    if (!this.sessions.has(tabId)) this.sessions.set(tabId, []);
  }

  clearSession(tabId: number): void {
    this.sessions.delete(tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
      this.state = ConversationState.Idle;
    }
  }

  addTurn(role: 'user' | 'agent', content: string): void {
    if (this.activeTabId === null) return;
    const turns = this.sessions.get(this.activeTabId) ?? [];
    turns.push({ role, content, timestamp: Date.now() });
    if (turns.length > MAX_CONVERSATION_TURNS) {
      turns.splice(0, turns.length - MAX_CONVERSATION_TURNS);
    }
    this.sessions.set(this.activeTabId, turns);
  }

  getHistory(tabId: number): ConversationTurn[] {
    return this.sessions.get(tabId) ?? [];
  }

  getTextOnlyHistory(tabId: number): Array<{ role: string; content: string }> {
    return this.getHistory(tabId).map(({ role, content }) => ({ role, content }));
  }

  resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.state = ConversationState.Idle;
      this.onIdleCallback?.();
    }, IDLE_TIMEOUT_MS);
  }

  clearIdleTimer(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  }

  isInConversation(): boolean { return this.state !== ConversationState.Idle; }

  getActiveTabId(): number | null { return this.activeTabId; }
}

/** Route a user utterance based on its classified intent. */
export function routeByIntent(
  intent: string,
  tabId: number,
  cm: ConversationManager,
): 'new_session' | 'continue' | 'cancel' {
  switch (intent) {
    case 'new_task':
      cm.clearSession(tabId);
      cm.startSession(tabId);
      return 'new_session';
    case 'interruption':
      cm.transition(ConversationState.Idle);
      return 'cancel';
    default:
      return 'continue';
  }
}
