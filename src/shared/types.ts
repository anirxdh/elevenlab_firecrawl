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

export type SttProvider = 'elevenlabs' | 'deepgram' | 'groq';

export interface ApiKeys {
  groqKey?: string;
  elevenLabsKey?: string;
  deepgramKey?: string;
}

export interface ExtensionSettings {
  shortcutKey: string; // default: '`'
  holdDelayMs: number; // default: 200
  maxRecordingMs: number; // default: 60000
  displayMode: DisplayMode; // default: 'both'
  explanationLevel: ExplanationLevel; // default: 'college'
  voiceId: string; // default: DEFAULT_VOICE_ID
  ttsModel: string; // default: DEFAULT_TTS_MODEL
  sttProvider: SttProvider; // default: 'groq'
}

export type ExtensionState = 'idle' | 'listening' | 'processing';

export type IconState = 'inactive' | 'ready' | 'recording';

export interface ShortcutEvent {
  type: 'shortcut-hold' | 'shortcut-release';
  cursorX: number;
  cursorY: number;
}

export interface ConversationTurn {
  role: 'user' | 'agent';
  content: string;
}

export interface ConversationInfo {
  turns: number;
  maxTurns: number;
}

export interface ElementInfo {
  selector: string;
  text: string;
  role?: string;
  href?: string;
}

export interface InputInfo {
  selector: string;
  label: string;
  type: string;
  value: string;
  placeholder: string;
}

export interface FormInfo {
  selector: string;
  action: string;
  inputs: InputInfo[];
}

export interface ProductInfo {
  name: string;
  price: string;
  selector: string;
}

export interface DomSnapshot {
  url: string;
  title: string;
  buttons: ElementInfo[];
  links: ElementInfo[];
  inputs: InputInfo[];
  forms: FormInfo[];
  headings: { level: number; text: string }[];
  images: { alt: string; src: string }[];
  tables: string[][];
  lists: string[];
  products: ProductInfo[];
  selectedText: string;
  metaDescription: string;
}

export interface TaskStep {
  action: string;
  selector?: string;
  value?: string;
  url?: string;
  direction?: string;
  speak?: string;
  reason?: string;
}

export interface TaskResponse {
  answer?: string;
  steps?: TaskStep[];
  done?: boolean;
  speak?: string;
  needs_clarification?: boolean;
  question?: string;
  options?: string[];
  suggestion?: string;
  requires_confirmation?: boolean;
  research?: { urls: string[] };
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
  | { action: 'bubble-done-summary'; steps: string[] }
  | { action: 'offscreen-amplitude'; data: number[] }
  | { action: 'offscreen-recording-complete'; audioBase64: string; mimeType: string }
  | { action: 'offscreen-error'; error: string }
  | { action: 'offscreen-ready' }
  | { action: 'offscreen-started' }
  | { action: 'elevenlabs-tts'; voiceId: string; text: string; apiKey: string; modelId: string }
  | { action: 'interrupt-tts' }
  | { action: 'tts-playback-finished' };
