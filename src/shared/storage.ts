import { ExtensionSettings } from './types';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from './constants';

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const stored = result[STORAGE_KEYS.SETTINGS];
  return stored ? { ...DEFAULT_SETTINGS, ...stored } : { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

export async function isMicPermissionGranted(): Promise<boolean> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.MIC_GRANTED);
  return result[STORAGE_KEYS.MIC_GRANTED] === true;
}

export async function setMicPermissionGranted(granted: boolean): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.MIC_GRANTED]: granted });
}

export async function isSetupComplete(): Promise<boolean> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETUP_COMPLETE);
  return result[STORAGE_KEYS.SETUP_COMPLETE] === true;
}

export async function setSetupComplete(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETUP_COMPLETE]: true });
}

export async function getApiKeys(): Promise<{ groqKey?: string; elevenLabsKey?: string }> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.API_KEYS);
  const stored = result[STORAGE_KEYS.API_KEYS] || {};
  return {
    groqKey: stored.groqKey || undefined,
    elevenLabsKey: stored.elevenLabsKey || undefined,
  };
}

export async function saveApiKeys(keys: {
  groqKey?: string;
  elevenLabsKey?: string;
}): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.API_KEYS]: keys });
}
