// src/__tests__/conversation-manager.test.ts
import { ConversationManager, ConversationState } from '../background/conversation-manager';

describe('ConversationManager', () => {
  let cm: ConversationManager;
  beforeEach(() => { cm = new ConversationManager(); });

  test('starts in idle state', () => {
    expect(cm.getState()).toBe(ConversationState.Idle);
  });

  test('transitions from idle to listening', () => {
    cm.transition(ConversationState.Listening);
    expect(cm.getState()).toBe(ConversationState.Listening);
  });

  test('records user turn', () => {
    cm.startSession(1);
    cm.addTurn('user', 'hello');
    expect(cm.getHistory(1)).toHaveLength(1);
    expect(cm.getHistory(1)[0].role).toBe('user');
  });

  test('records agent turn', () => {
    cm.startSession(1);
    cm.addTurn('agent', 'how can I help?');
    const history = cm.getHistory(1);
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('how can I help?');
  });

  test('caps history at 20 turns', () => {
    cm.startSession(1);
    for (let i = 0; i < 25; i++) {
      cm.addTurn('user', `message ${i}`);
    }
    expect(cm.getHistory(1).length).toBeLessThanOrEqual(20);
  });

  test('clears session', () => {
    cm.startSession(1);
    cm.addTurn('user', 'hello');
    cm.clearSession(1);
    expect(cm.getHistory(1)).toHaveLength(0);
  });

  test('idle timeout after inactivity', () => {
    jest.useFakeTimers();
    cm.startSession(1);
    cm.transition(ConversationState.Listening);
    cm.resetIdleTimer();
    jest.advanceTimersByTime(31000);
    expect(cm.getState()).toBe(ConversationState.Idle);
    jest.useRealTimers();
  });

  test('getTextOnlyHistory strips context', () => {
    cm.startSession(1);
    cm.addTurn('user', 'hello');
    cm.addTurn('agent', 'hi there');
    const textOnly = cm.getTextOnlyHistory(1);
    expect(textOnly).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'agent', content: 'hi there' },
    ]);
  });

  test('isInConversation returns false when idle', () => {
    expect(cm.isInConversation()).toBe(false);
  });

  test('isInConversation returns true when active', () => {
    cm.transition(ConversationState.Listening);
    expect(cm.isInConversation()).toBe(true);
  });
});
