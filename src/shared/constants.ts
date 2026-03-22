import { ExtensionSettings } from './types';

// ElevenLabs TTS defaults
export const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
export const DEFAULT_TTS_MODEL = 'eleven_flash_v2_5';

export const DEFAULT_SETTINGS: ExtensionSettings = {
  shortcutKey: '`',
  holdDelayMs: 200,
  maxRecordingMs: 60000,
  displayMode: 'both',
  explanationLevel: 'college',
  voiceId: DEFAULT_VOICE_ID,
  ttsModel: DEFAULT_TTS_MODEL,
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
