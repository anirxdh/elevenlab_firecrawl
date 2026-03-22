/**
 * Unit tests for classifyResponse() from agent-executor.ts
 */

// Mock chrome globals before import
(global as any).chrome = {
  tabs: { sendMessage: jest.fn() },
};

import { classifyResponse } from '../background/agent-executor';

describe('classifyResponse', () => {
  it('returns "clarify" when needs_clarification is true', () => {
    expect(classifyResponse({
      type: 'answer',
      needs_clarification: true,
      question: 'Which one?',
    } as any)).toBe('clarify');
  });

  it('returns "options" when options array is non-empty', () => {
    expect(classifyResponse({
      type: 'answer',
      options: ['A', 'B'],
      question: 'Pick one',
    } as any)).toBe('options');
  });

  it('returns "suggest" when suggestion with requires_confirmation', () => {
    expect(classifyResponse({
      type: 'answer',
      suggestion: 'Try the blue one',
      requires_confirmation: true,
    } as any)).toBe('suggest');
  });

  it('returns "speak" when speak is set without actions', () => {
    expect(classifyResponse({
      type: 'answer',
      speak: 'All done, the page is loaded.',
    } as any)).toBe('speak');
  });

  it('returns "done" when type is done', () => {
    expect(classifyResponse({
      type: 'done',
      summary: 'Complete',
    } as any)).toBe('done');
  });

  it('returns "action" for standard steps response', () => {
    expect(classifyResponse({
      type: 'steps',
      actions: [{ action: 'click', selector: '#btn', description: 'Click' }],
    } as any)).toBe('action');
  });

  it('returns "action" for answer type without conversational fields', () => {
    expect(classifyResponse({
      type: 'answer',
      text: 'The price is $10',
    } as any)).toBe('action');
  });

  it('prioritizes clarify over options', () => {
    expect(classifyResponse({
      type: 'answer',
      needs_clarification: true,
      options: ['A', 'B'],
      question: 'Which?',
    } as any)).toBe('clarify');
  });

  it('prioritizes options over suggest', () => {
    expect(classifyResponse({
      type: 'answer',
      options: ['A'],
      suggestion: 'Try A',
      requires_confirmation: true,
    } as any)).toBe('options');
  });

  it('does not return speak when actions are present', () => {
    expect(classifyResponse({
      type: 'steps',
      speak: 'Clicking...',
      actions: [{ action: 'click', selector: '#x', description: 'Click' }],
    } as any)).toBe('action');
  });

  it('returns "options" even with empty question', () => {
    expect(classifyResponse({
      type: 'answer',
      options: ['One', 'Two'],
    } as any)).toBe('options');
  });

  it('returns "action" when options is empty array', () => {
    expect(classifyResponse({
      type: 'answer',
      options: [],
      text: 'nothing',
    } as any)).toBe('action');
  });
});
