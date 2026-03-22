const MIME_PREFERENCE = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/wav',
];

const MIME_TO_EXT: Record<string, string> = {
  'audio/webm;codecs=opus': 'webm',
  'audio/webm': 'webm',
  'audio/ogg;codecs=opus': 'ogg',
  'audio/mp4': 'mp4',
  'audio/wav': 'wav',
};

export function getSupportedMimeType(): string {
  if (typeof MediaRecorder !== 'undefined') {
    for (const mime of MIME_PREFERENCE) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
  }
  return 'audio/webm';
}

export function getMimeExtension(mimeType: string): string {
  return MIME_TO_EXT[mimeType] ?? 'webm';
}
