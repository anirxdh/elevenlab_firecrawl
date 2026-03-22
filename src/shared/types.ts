export type DisplayMode = 'both' | 'audio-only' | 'text-only';

export type BubbleState =
  | 'idle'           // hidden, no bubble
  | 'listening'      // waveform animation near cursor (user is speaking)
  | 'transcribing'   // "Transcribing..." label
  | 'understanding'  // "Understanding..." label
  | 'planning'       // "Planning..." label
  | 'executing'      // "Clicking Add to Cart..." — dynamic step name
  | 'answering'      // Streaming text response inside bubble
  | 'error'          // Error message display
  | 'done';          // Brief "Done" before auto-dismiss

export type ExplanationLevel = 'kid' | 'school' | 'college' | 'phd' | 'executive';

export interface ExtensionSettings {
  shortcutKey: string; // default: '`'
  holdDelayMs: number; // default: 200
  maxRecordingMs: number; // default: 60000
  displayMode: DisplayMode; // default: 'both'
  explanationLevel: ExplanationLevel; // default: 'college'
}

export type ExtensionState = 'idle' | 'listening' | 'processing';

export type IconState = 'inactive' | 'ready' | 'recording';

export interface ShortcutEvent {
  type: 'shortcut-hold' | 'shortcut-release';
  cursorX: number;
  cursorY: number;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationInfo {
  turns: number;
  maxTurns: number;
}

export type MessageType =
  | { action: 'shortcut-hold'; cursorX: number; cursorY: number }
  | { action: 'shortcut-release'; cursorX: number; cursorY: number }
  | { action: 'capture-screenshot' }
  | { action: 'get-state' }
  | { action: 'state-changed'; state: ExtensionState }
  | { action: 'check-mic-permission' }
  | { action: 'mic-permission-result'; granted: boolean }
  | { action: 'open-welcome' }
  | { action: 'recording-complete'; audioBase64: string; mimeType: string }
  | { action: 'shortcut-release-complete'; screenshotUrl: string }
  | { action: 'pipeline-stage'; stage: 'transcribing' | 'thinking' | 'streaming' | 'complete' | 'error'; transcript?: string }
  | { action: 'stream-chunk'; text: string }
  | { action: 'stream-complete'; fullText: string }
  | { action: 'tts-summary'; summary: string }
  | { action: 'pipeline-error'; error: string }
  | { action: 'follow-up'; text: string }
  | { action: 'clear-conversation' }
  | { action: 'get-conversation-info' }
  | { action: 'conversation-info'; info: ConversationInfo }
  | { action: 'scrape-dom' }
  | { action: 'hide-overlay' }
  | { action: 'show-overlay' }
  | { action: 'bubble-state'; state: BubbleState; label?: string }
  | { action: 'bubble-answer-chunk'; text: string }
  | { action: 'bubble-answer-done'; fullText: string }
  | { action: 'bubble-step'; stepName: string; stepIndex: number; totalSteps: number }
  | { action: 'amplitude-data'; data: number[] }
  | { action: 'start-listening' }
  | { action: 'execute-action'; actionType: string; selector?: string; value?: string; url?: string; direction?: string; description: string }
  | { action: 'action-result'; ok: boolean; summary: string; error?: string }
  | { action: 'bubble-reasoning'; text: string }
  | { action: 'cancel-agent-loop' }
  | { action: 'wait-for-dom-stable'; timeout?: number; settleMs?: number }
  | { action: 'bubble-set-task'; task: string }
  | { action: 'bubble-done-summary'; steps: string[] };
