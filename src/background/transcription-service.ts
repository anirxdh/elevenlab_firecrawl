import { transcribeAudio as elevenLabsSTT } from './api/elevenlabs-stt';
import { transcribeAudio as deepgramSTT } from './api/deepgram-stt';
import { transcribeAudio as groqSTT } from './api/groq-stt';

/**
 * Transcribe audio using Groq Whisper (primary) with ElevenLabs and Deepgram fallbacks.
 * Frontend-direct — no backend involvement.
 *
 * Fallback chain: Groq -> ElevenLabs -> Deepgram
 */
export async function transcribe(
  audioBase64: string,
  mimeType: string,
  elevenLabsKey: string,
  deepgramKey?: string,
  groqKey?: string,
): Promise<string> {
  // Try Groq first (most reliable, free tier)
  if (groqKey) {
    try {
      return await groqSTT(audioBase64, mimeType, groqKey);
    } catch (err) {
      console.warn('[ScreenSense] Groq STT failed, trying ElevenLabs fallback:', err);
    }
  }

  // Try ElevenLabs second
  try {
    return await elevenLabsSTT(audioBase64, mimeType, elevenLabsKey);
  } catch (err) {
    console.warn('[ScreenSense] ElevenLabs STT failed, trying Deepgram fallback:', err);
  }

  // Try Deepgram last
  if (deepgramKey) {
    try {
      return await deepgramSTT(audioBase64, mimeType, deepgramKey);
    } catch (deepgramErr) {
      console.warn('[ScreenSense] Deepgram STT also failed:', deepgramErr);
    }
  }

  throw new Error('All STT providers failed — check your API keys in Settings');
}
