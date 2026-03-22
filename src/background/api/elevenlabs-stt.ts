import { getMimeExtension } from '../../shared/mime-utils';

const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';

/**
 * Transcribe audio using ElevenLabs Speech-to-Text API.
 * Converts base64-encoded audio to a Blob, sends via FormData.
 */
export async function transcribeAudio(
  audioBase64: string,
  mimeType: string,
  apiKey: string
): Promise<string> {
  // Convert base64 to binary
  const binaryString = atob(audioBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const audioBlob = new Blob([bytes], { type: mimeType });

  // Determine file extension from mimeType
  const ext = getMimeExtension(mimeType);

  const formData = new FormData();
  formData.append('audio', audioBlob, `recording.${ext}`);
  formData.append('model_id', 'scribe_v1');

  const response = await fetch(ELEVENLABS_STT_URL, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    console.error('[ScreenSense] ElevenLabs STT error:', response.status, errorBody);
    if (response.status === 401) {
      throw new Error('ElevenLabs API key missing or invalid');
    }
    throw new Error(`ElevenLabs STT failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  return data.text;
}
