import { getSupportedMimeType, getMimeExtension } from '../shared/mime-utils';

describe('mime-utils', () => {
  test('getMimeExtension returns correct extension for known types', () => {
    expect(getMimeExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(getMimeExtension('audio/webm')).toBe('webm');
    expect(getMimeExtension('audio/ogg;codecs=opus')).toBe('ogg');
    expect(getMimeExtension('audio/mp4')).toBe('mp4');
    expect(getMimeExtension('audio/wav')).toBe('wav');
  });

  test('getMimeExtension returns webm for unknown types', () => {
    expect(getMimeExtension('audio/unknown')).toBe('webm');
  });

  test('getSupportedMimeType returns a string', () => {
    const result = getSupportedMimeType();
    expect(typeof result).toBe('string');
  });
});
