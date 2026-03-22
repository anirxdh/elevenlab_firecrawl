export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private autoStopTimer: number | null = null;
  private onAmplitude: ((data: Uint8Array) => void) | null = null;
  private animFrameId: number | null = null;
  private stopped = false;

  async start(options: {
    maxDurationMs: number;
    onAmplitude?: (data: Uint8Array) => void;
    onAutoStop?: () => void;
  }): Promise<void> {
    this.stopped = false;
    this.chunks = [];

    // Get microphone stream
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Set up AudioContext and AnalyserNode for amplitude data
    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    source.connect(this.analyser);

    // Choose best available MIME type
    let mimeType: string | undefined;
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/webm')) {
      mimeType = 'audio/webm';
    }

    // Create MediaRecorder
    this.mediaRecorder = new MediaRecorder(
      this.stream,
      mimeType ? { mimeType } : undefined
    );

    this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    this.mediaRecorder.start(100); // Collect data every 100ms

    // Auto-stop timer
    this.autoStopTimer = window.setTimeout(() => {
      if (!this.stopped) {
        console.log('[ScreenSense] Auto-stop: max recording duration reached');
        this.stop().then(() => {
          options.onAutoStop?.();
        });
      }
    }, options.maxDurationMs);

    // Amplitude polling via requestAnimationFrame
    if (options.onAmplitude) {
      this.onAmplitude = options.onAmplitude;
      this.pollAmplitude();
    }
  }

  private pollAmplitude(): void {
    if (this.stopped || !this.analyser || !this.onAmplitude) return;

    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    this.onAmplitude(data);

    this.animFrameId = requestAnimationFrame(() => this.pollAmplitude());
  }

  async stop(): Promise<Blob> {
    this.stopped = true;

    // Clear auto-stop timer
    if (this.autoStopTimer !== null) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }

    // Cancel amplitude polling
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.onAmplitude = null;

    // Stop MediaRecorder and collect final data
    const blob = await new Promise<Blob>((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve(new Blob(this.chunks, { type: 'audio/webm' }));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
        resolve(new Blob(this.chunks, { type: mimeType }));
      };

      this.mediaRecorder.stop();
    });

    // Stop all stream tracks
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    // Close AudioContext
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
      this.analyser = null;
    }

    this.mediaRecorder = null;

    return blob;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  destroy(): void {
    if (this.autoStopTimer !== null) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }

    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // Ignore errors during cleanup
      }
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
      this.analyser = null;
    }

    this.mediaRecorder = null;
    this.chunks = [];
    this.onAmplitude = null;
    this.stopped = true;
  }
}
