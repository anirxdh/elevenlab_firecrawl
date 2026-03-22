const DEEPGRAM_STT_URL = 'https://api.deepgram.com/v1/listen';

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

  const response = await fetch(
    `${DEEPGRAM_STT_URL}?model=nova-3&smart_format=true&language=en`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': mimeType,
      },
      body: audioBlob,
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Deepgram STT failed (HTTP ${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';

  if (!transcript.trim()) {
    throw new Error('No transcript produced — audio may be too short or unclear');
  }

  return transcript.trim();
}
