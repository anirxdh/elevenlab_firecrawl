import { transcribeAudio as elevenLabsSTT } from './api/elevenlabs-stt';
import { transcribeAudio as groqSTT } from './api/groq-stt';

/**
 * Transcribe audio using ElevenLabs (primary) with Groq Whisper fallback.
 * Frontend-direct — no backend involvement.
 *
 * Both STT functions share the same signature: (audioBase64, mimeType, apiKey)
 *
 * @param audioBase64 - Base64-encoded audio data
 * @param mimeType    - MIME type of the audio (e.g., "audio/webm")
 * @param elevenLabsKey - ElevenLabs API key (primary STT)
 * @param groqKey     - Groq API key (fallback STT, optional)
 */
export async function transcribe(
  audioBase64: string,
  mimeType: string,
  elevenLabsKey: string,
  groqKey?: string,
): Promise<string> {
  try {
    return await elevenLabsSTT(audioBase64, mimeType, elevenLabsKey);
  } catch (err) {
    console.warn('[ScreenSense] ElevenLabs STT failed, trying Groq fallback:', err);
    if (!groqKey) throw new Error('ElevenLabs STT failed and no Groq key configured');
    return await groqSTT(audioBase64, mimeType, groqKey);
  }
}
