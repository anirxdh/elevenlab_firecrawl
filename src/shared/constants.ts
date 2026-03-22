import { ExtensionSettings } from './types';

export const DEFAULT_SETTINGS: ExtensionSettings = {
  shortcutKey: '`',
  holdDelayMs: 200,
  maxRecordingMs: 60000,
  displayMode: 'both',
  explanationLevel: 'college',
};

export const STORAGE_KEYS = {
  SETTINGS: 'screensense-settings',
  SETUP_COMPLETE: 'screensense-setup-complete',
  MIC_GRANTED: 'screensense-mic-granted',
  API_KEYS: 'screensense-api-keys',
} as const;

export const MAX_CONVERSATION_TURNS = 20;
