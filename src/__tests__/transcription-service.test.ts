import { transcribe } from '../background/transcription-service';

jest.mock('../background/api/elevenlabs-stt', () => ({
  transcribeAudio: jest.fn(),
}));
jest.mock('../background/api/groq-stt', () => ({
  transcribeAudio: jest.fn(),
}));

import { transcribeAudio as elevenLabsSTT } from '../background/api/elevenlabs-stt';
import { transcribeAudio as groqSTT } from '../background/api/groq-stt';

describe('transcription-service', () => {
  const mockAudioBase64 = 'SGVsbG8gV29ybGQ=';
  beforeEach(() => jest.clearAllMocks());

  test('uses ElevenLabs as primary STT', async () => {
    (elevenLabsSTT as jest.Mock).mockResolvedValue('hello world');
    const result = await transcribe(mockAudioBase64, 'audio/webm', 'test-key');
    expect(result).toBe('hello world');
    expect(elevenLabsSTT).toHaveBeenCalledTimes(1);
    expect(groqSTT).not.toHaveBeenCalled();
  });

  test('falls back to Groq when ElevenLabs fails', async () => {
    (elevenLabsSTT as jest.Mock).mockRejectedValue(new Error('ElevenLabs down'));
    (groqSTT as jest.Mock).mockResolvedValue('hello world');
    const result = await transcribe(mockAudioBase64, 'audio/webm', 'test-key', 'groq-key');
    expect(result).toBe('hello world');
    expect(groqSTT).toHaveBeenCalledTimes(1);
  });

  test('throws when both STT providers fail', async () => {
    (elevenLabsSTT as jest.Mock).mockRejectedValue(new Error('ElevenLabs down'));
    (groqSTT as jest.Mock).mockRejectedValue(new Error('Groq down'));
    await expect(transcribe(mockAudioBase64, 'audio/webm', 'test-key', 'groq-key')).rejects.toThrow();
  });

  test('throws when ElevenLabs fails and no Groq key provided', async () => {
    (elevenLabsSTT as jest.Mock).mockRejectedValue(new Error('ElevenLabs down'));
    await expect(transcribe(mockAudioBase64, 'audio/webm', 'test-key')).rejects.toThrow(
      /no Groq key/
    );
  });
});
