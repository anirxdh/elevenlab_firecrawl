import { transcribeAudio as elevenLabsSTT } from './api/elevenlabs-stt';
import { transcribeAudio as deepgramSTT } from './api/deepgram-stt';
import { transcribeAudio as groqSTT } from './api/groq-stt';

/**
 * Transcribe audio using ElevenLabs (primary) with Deepgram and Groq Whisper fallbacks.
 * Frontend-direct — no backend involvement.
 *
 * Fallback chain: ElevenLabs -> Deepgram -> Groq
 *
 * All STT functions share the same signature: (audioBase64, mimeType, apiKey)
 *
 * @param audioBase64  - Base64-encoded audio data
 * @param mimeType     - MIME type of the audio (e.g., "audio/webm")
 * @param elevenLabsKey - ElevenLabs API key (primary STT)
 * @param deepgramKey  - Deepgram API key (second fallback, optional)
 * @param groqKey      - Groq API key (third fallback, optional)
 */
export async function transcribe(
  audioBase64: string,
  mimeType: string,
  elevenLabsKey: string,
  deepgramKey?: string,
  groqKey?: string,
): Promise<string> {
  try {
    return await elevenLabsSTT(audioBase64, mimeType, elevenLabsKey);
  } catch (err) {
    console.warn('[ScreenSense] ElevenLabs STT failed, trying Deepgram fallback:', err);

    if (deepgramKey) {
      try {
        return await deepgramSTT(audioBase64, mimeType, deepgramKey);
      } catch (deepgramErr) {
        console.warn('[ScreenSense] Deepgram STT failed, trying Groq fallback:', deepgramErr);
      }
    }

    if (!groqKey) throw new Error('ElevenLabs STT failed and no fallback keys configured');
    return await groqSTT(audioBase64, mimeType, groqKey);
  }
}
