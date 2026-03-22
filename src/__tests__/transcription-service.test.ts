import { transcribe } from '../background/transcription-service';

jest.mock('../background/api/elevenlabs-stt', () => ({
  transcribeAudio: jest.fn(),
}));
jest.mock('../background/api/deepgram-stt', () => ({
  transcribeAudio: jest.fn(),
}));
jest.mock('../background/api/groq-stt', () => ({
  transcribeAudio: jest.fn(),
}));

import { transcribeAudio as elevenLabsSTT } from '../background/api/elevenlabs-stt';
import { transcribeAudio as deepgramSTT } from '../background/api/deepgram-stt';
import { transcribeAudio as groqSTT } from '../background/api/groq-stt';

describe('transcription-service', () => {
  const mockAudioBase64 = 'SGVsbG8gV29ybGQ=';
  beforeEach(() => jest.clearAllMocks());

  test('uses ElevenLabs as primary STT', async () => {
    (elevenLabsSTT as jest.Mock).mockResolvedValue('hello world');
    const result = await transcribe(mockAudioBase64, 'audio/webm', 'test-key');
    expect(result).toBe('hello world');
    expect(elevenLabsSTT).toHaveBeenCalledTimes(1);
    expect(deepgramSTT).not.toHaveBeenCalled();
    expect(groqSTT).not.toHaveBeenCalled();
  });

  test('falls back to Deepgram when ElevenLabs fails', async () => {
    (elevenLabsSTT as jest.Mock).mockRejectedValue(new Error('ElevenLabs down'));
    (deepgramSTT as jest.Mock).mockResolvedValue('hello from deepgram');
    const result = await transcribe(mockAudioBase64, 'audio/webm', 'test-key', 'deepgram-key');
    expect(result).toBe('hello from deepgram');
    expect(deepgramSTT).toHaveBeenCalledTimes(1);
    expect(groqSTT).not.toHaveBeenCalled();
  });

  test('falls back to Groq when ElevenLabs and Deepgram fail', async () => {
    (elevenLabsSTT as jest.Mock).mockRejectedValue(new Error('ElevenLabs down'));
    (deepgramSTT as jest.Mock).mockRejectedValue(new Error('Deepgram down'));
    (groqSTT as jest.Mock).mockResolvedValue('hello from groq');
    // deepgramKey is 4th arg, groqKey is 5th arg
    const result = await transcribe(mockAudioBase64, 'audio/webm', 'test-key', 'deepgram-key', 'groq-key');
    expect(result).toBe('hello from groq');
    expect(groqSTT).toHaveBeenCalledTimes(1);
  });

  test('falls back to Groq when ElevenLabs fails (no Deepgram key)', async () => {
    (elevenLabsSTT as jest.Mock).mockRejectedValue(new Error('ElevenLabs down'));
    (groqSTT as jest.Mock).mockResolvedValue('hello from groq');
    // Skip deepgramKey (undefined), pass groqKey as 5th arg
    const result = await transcribe(mockAudioBase64, 'audio/webm', 'test-key', undefined, 'groq-key');
    expect(result).toBe('hello from groq');
    expect(deepgramSTT).not.toHaveBeenCalled();
    expect(groqSTT).toHaveBeenCalledTimes(1);
  });

  test('throws when all STT providers fail', async () => {
    (elevenLabsSTT as jest.Mock).mockRejectedValue(new Error('ElevenLabs down'));
    (deepgramSTT as jest.Mock).mockRejectedValue(new Error('Deepgram down'));
    (groqSTT as jest.Mock).mockRejectedValue(new Error('Groq down'));
    await expect(
      transcribe(mockAudioBase64, 'audio/webm', 'test-key', 'deepgram-key', 'groq-key')
    ).rejects.toThrow();
  });

  test('throws when ElevenLabs fails and no fallback keys provided', async () => {
    (elevenLabsSTT as jest.Mock).mockRejectedValue(new Error('ElevenLabs down'));
    await expect(transcribe(mockAudioBase64, 'audio/webm', 'test-key')).rejects.toThrow(
      /no fallback keys/
    );
  });
});
