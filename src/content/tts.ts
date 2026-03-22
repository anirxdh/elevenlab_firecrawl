/**
 * Text-to-Speech module using ElevenLabs API.
 * Falls back to Web Speech API if no API key is configured.
 */
import { getApiKeys } from '../shared/storage';

const ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel — natural, clear
const ELEVENLABS_MODEL = 'eleven_flash_v2_5';

let enabled = true;
let currentAudio: HTMLAudioElement | null = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;

export function setTtsEnabled(value: boolean): void {
  enabled = value;
  if (!value) stop();
}

export function isTtsEnabled(): boolean {
  return enabled;
}

/** Strip markdown for cleaner speech */
function cleanForSpeech(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^- /gm, '')
    .replace(/#{1,6}\s*/g, '');
}

/** ElevenLabs TTS — routes through service worker to avoid page CSP blocking */
async function speakElevenLabs(text: string, apiKey: string): Promise<void> {
  const clean = cleanForSpeech(text);

  try {
    // Send to service worker which has unrestricted network access
    const response: { ok: boolean; audioBase64?: string; error?: string } = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: 'elevenlabs-tts',
          text: clean,
          apiKey,
          voiceId: ELEVENLABS_VOICE_ID,
          modelId: ELEVENLABS_MODEL,
        },
        (resp) => resolve(resp || { ok: false, error: 'No response' })
      );
    });

    if (!response.ok || !response.audioBase64) {
      console.warn('[ScreenSense] ElevenLabs TTS failed via SW:', response.error, '— falling back to Web Speech');
      speakWebSpeech(text);
      return;
    }

    // Convert base64 to audio blob and play
    const binaryString = atob(response.audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const audioBlob = new Blob([bytes], { type: 'audio/mpeg' });
    const audioUrl = URL.createObjectURL(audioBlob);

    currentAudio = new Audio(audioUrl);
    currentAudio.addEventListener('ended', () => {
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
    });
    currentAudio.play();
  } catch (err) {
    console.warn('[ScreenSense] ElevenLabs TTS error:', err);
    speakWebSpeech(text);
  }
}

/** Web Speech API fallback */
function speakWebSpeech(text: string): void {
  const clean = cleanForSpeech(text);
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = 1.05;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  const voices = speechSynthesis.getVoices();
  const preferred = voices.find(
    (v) => v.name.includes('Samantha') || v.name.includes('Google US English') || v.name.includes('Daniel')
  );
  if (preferred) utterance.voice = preferred;

  currentUtterance = utterance;
  speechSynthesis.speak(utterance);
}

export async function speak(text: string): Promise<void> {
  console.log('[ScreenSense][TTS] speak() called, enabled:', enabled, 'text:', text.substring(0, 80));
  if (!enabled) return;
  stop();

  try {
    const keys = await getApiKeys();
    console.log('[ScreenSense][TTS] API keys loaded, hasElevenLabsKey:', !!keys.elevenLabsKey);
    if (keys.elevenLabsKey) {
      await speakElevenLabs(text, keys.elevenLabsKey);
    } else {
      console.log('[ScreenSense][TTS] No ElevenLabs key, falling back to Web Speech API');
      speakWebSpeech(text);
    }
  } catch (err) {
    console.warn('[ScreenSense] TTS error:', err);
    // Last resort fallback
    try { speakWebSpeech(text); } catch { /* silent */ }
  }
}

export function stop(): void {
  // Stop ElevenLabs audio
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  // Stop Web Speech
  speechSynthesis.cancel();
  currentUtterance = null;
}

export function isSpeaking(): boolean {
  return !!(currentAudio && !currentAudio.paused) || speechSynthesis.speaking;
}
