import { ExtensionSettings } from './types';

// ElevenLabs TTS defaults
export const DEFAULT_VOICE_ID = '9BWtsMINqrJLrRacOk9x';

export const VOICE_OPTIONS = [
  { id: '9BWtsMINqrJLrRacOk9x', name: 'Aria', description: 'Expressive, natural female' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Chris', description: 'Casual, friendly male' },
  { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Brian', description: 'Deep, authoritative male' },
  { id: '29vD33N1CtxCmqQRPOHJ', name: 'Drew', description: 'Professional, clear male' },
  { id: 'iP95p4xoKVk53GoZ742B', name: 'Charlotte', description: 'Calm, Swedish female' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', description: 'Deep, young male' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', description: 'Classic, warm female' },
] as const;
export const DEFAULT_TTS_MODEL = 'eleven_flash_v2_5';

export const DEFAULT_SETTINGS: ExtensionSettings = {
  shortcutKey: '`',
  holdDelayMs: 50,
  maxRecordingMs: 60000,
  displayMode: 'both',
  explanationLevel: 'college',
  voiceId: DEFAULT_VOICE_ID,
  ttsModel: DEFAULT_TTS_MODEL,
  sttProvider: 'groq',
};

export const STORAGE_KEYS = {
  SETTINGS: 'screensense-settings',
  SETUP_COMPLETE: 'screensense-setup-complete',
  MIC_GRANTED: 'screensense-mic-granted',
  API_KEYS: 'screensense-api-keys',
} as const;

export const MAX_CONVERSATION_TURNS = 20;

// Backend connection
export const BACKEND_URL = 'http://localhost:8000';
export const BACKEND_WS_URL = 'ws://localhost:8000';

// Agent loop limits
/** Max reasoning iterations before forcing completion */
export const MAX_AGENT_ITERATIONS = 25;
/** Max chars of DOM snapshot sent to Nova (prevents token overflow) */
export const DOM_SNAPSHOT_MAX_CHARS = 30000;
/** Timeout for backend API calls in ms */
export const BACKEND_TIMEOUT_MS = 15000;
/** Minimum ms between consecutive browser actions */
export const MIN_ACTION_INTERVAL_MS = 300;
