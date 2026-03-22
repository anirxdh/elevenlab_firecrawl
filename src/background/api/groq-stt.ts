import { getMimeExtension } from '../../shared/mime-utils';

const GROQ_STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

/**
 * Transcribe audio using Groq Whisper API (free tier).
 * Drop-in replacement for ElevenLabs STT — same signature.
 */
export async function transcribeAudio(
  audioBase64: string,
  mimeType: string,
  apiKey: string
): Promise<string> {
  const binaryString = atob(audioBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const audioBlob = new Blob([bytes], { type: mimeType });

  const ext = getMimeExtension(mimeType);

  const formData = new FormData();
  formData.append('file', audioBlob, `recording.${ext}`);
  formData.append('model', 'whisper-large-v3-turbo');

  const response = await fetch(GROQ_STT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Check your API key in Settings');
    }
    let detail = '';
    try {
      const errBody = await response.json();
      detail = errBody?.error?.message || JSON.stringify(errBody);
    } catch {
      detail = `HTTP ${response.status}`;
    }
    console.error('[ScreenSense] Groq STT error:', response.status, detail);
    if (response.status === 429) {
      throw new Error('Rate limit hit — wait a moment and try again');
    }
    throw new Error(`Couldn't catch that — ${detail}`);
  }

  const data = await response.json();
  return data.text;
}
