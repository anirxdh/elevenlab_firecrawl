/**
 * Offscreen document for audio recording.
 * Runs in the extension's origin so mic permission is granted once and persists
 * across all page navigations.
 */
import { getSupportedMimeType } from '../shared/mime-utils';

let mediaRecorder: MediaRecorder | null = null;
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let stopped = false;
let amplitudeInterval: ReturnType<typeof setInterval> | null = null;

// Silence detection
let silentSamples = 0;
const SILENCE_THRESHOLD = 0.02;
const SILENCE_DURATION_SAMPLES = 30; // ~1.5s at 50ms polling

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function startRecording(): Promise<void> {
  console.log('[ScreenSense][offscreen] startRecording called');
  stopped = false;
  chunks = [];
  silentSamples = 0;

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('[ScreenSense][offscreen] getUserMedia succeeded, tracks:', stream.getTracks().length);
  } catch (err) {
    console.error('[ScreenSense][offscreen] getUserMedia failed:', err);
    chrome.runtime.sendMessage({ action: 'offscreen-error', error: 'Microphone access denied' }).catch((err) => console.error('[ScreenSense] offscreen-error send:', err));
    return;
  }

  // Set up AudioContext + AnalyserNode for amplitude data
  audioContext = new AudioContext();
  // Resume AudioContext in case autoplay policy suspends it
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
  console.log('[ScreenSense][offscreen] AudioContext state:', audioContext.state);
  const source = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;
  source.connect(analyser);

  // Choose best MIME type using shared utility
  const mimeType = getSupportedMimeType();

  mediaRecorder = new MediaRecorder(stream, { mimeType });

  mediaRecorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  mediaRecorder.start(100);

  // Send amplitude data every 50ms
  let ampLogCount = 0;
  amplitudeInterval = setInterval(() => {
    if (stopped || !analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const arr = Array.from(data);
    // Log first 5 sends so the user can verify data in the offscreen console
    if (ampLogCount < 5) {
      const max = Math.max(...arr);
      const sum = arr.reduce((a, b) => a + b, 0);
      console.log(`[ScreenSense][offscreen] amplitude #${ampLogCount} max=${max} sum=${sum} bins=${arr.length} first8=`, arr.slice(0, 8));
      ampLogCount++;
    }
    // Send as regular array (Uint8Array doesn't serialize well in chrome messages)
    chrome.runtime.sendMessage({ action: 'offscreen-amplitude', data: arr }).catch((err) => console.error('[ScreenSense] amplitude send:', err));

    // Silence detection — auto-stop after ~1.5s of continuous silence
    const maxAmplitude = Math.max(...arr) / 255;
    if (maxAmplitude < SILENCE_THRESHOLD) {
      silentSamples++;
      if (silentSamples >= SILENCE_DURATION_SAMPLES) {
        console.log('[ScreenSense][offscreen] Silence detected, auto-stopping recording');
        stopRecording();
        return;
      }
    } else {
      silentSamples = 0;
    }
  }, 50);

  chrome.runtime.sendMessage({ action: 'offscreen-started' }).catch((err) => console.error('[ScreenSense] offscreen-started send:', err));
}

async function stopRecording(): Promise<void> {
  console.log('[ScreenSense][offscreen] stopRecording called, mediaRecorder state:', mediaRecorder?.state, 'chunks:', chunks.length);
  stopped = true;

  // Stop amplitude polling
  if (amplitudeInterval !== null) {
    clearInterval(amplitudeInterval);
    amplitudeInterval = null;
  }

  // Stop MediaRecorder and collect audio
  const blob = await new Promise<Blob>((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      console.log('[ScreenSense][offscreen] MediaRecorder already inactive, using existing chunks:', chunks.length);
      resolve(new Blob(chunks, { type: 'audio/webm' }));
      return;
    }

    mediaRecorder.onstop = () => {
      const type = mediaRecorder?.mimeType || 'audio/webm';
      console.log('[ScreenSense][offscreen] MediaRecorder stopped, chunks:', chunks.length, 'mimeType:', type);
      resolve(new Blob(chunks, { type }));
    };

    mediaRecorder.stop();
  });

  // Stop stream tracks
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  // Close AudioContext
  if (audioContext) {
    await audioContext.close();
    audioContext = null;
    analyser = null;
  }

  mediaRecorder = null;

  // Convert to base64 and send back
  const audioBase64 = await blobToBase64(blob);
  console.log('[ScreenSense][offscreen] Sending offscreen-recording-complete, blob size:', blob.size, 'base64 length:', audioBase64.length);
  chrome.runtime.sendMessage({
    action: 'offscreen-recording-complete',
    audioBase64,
    mimeType: blob.type,
  }).catch((err) => {
    console.error('[ScreenSense][offscreen] Failed to send recording-complete:', err);
  });
}

// Listen for commands from service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'offscreen') return;

  if (message.action === 'start-recording') {
    console.log('[ScreenSense][offscreen] Starting recording...');
    startRecording();
  } else if (message.action === 'stop-recording') {
    console.log('[ScreenSense][offscreen] Stopping recording...');
    stopRecording();
  }
});

// Signal to the service worker that the offscreen script has loaded
// and is ready to receive messages. This fixes the race condition where
// createDocument() resolves before the script's onMessage listener is registered.
console.log('[ScreenSense][offscreen] Script loaded, sending ready signal');
chrome.runtime.sendMessage({ action: 'offscreen-ready' }).catch((err) => console.error('[ScreenSense] offscreen-ready send:', err));
