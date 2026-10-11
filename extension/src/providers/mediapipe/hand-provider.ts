import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { PointerProvider, PointerSample, Unsubscribe } from '@iris/protocol';
import { toPointerSample } from './hand-feature';

// WASM and model are bundled by scripts/setup-mediapipe.mjs; nothing loads remotely.
async function createLandmarker(): Promise<HandLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/mediapipe/hand_landmarker.task', delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 1,
  });
}

/**
 * PointerProvider backed by MediaPipe Hand Landmarker, run on every frame of the camera video the
 * face tracker already reads, only while started. The model loads on the first start. Landmarks
 * are turned into a fingertip and a pinch gap here and never leave the computer.
 */
export class MediaPipePointerProvider implements PointerProvider {
  private landmarker: HandLandmarker | null = null;
  private frameRequest: number | null = null;
  private readonly listeners = new Set<(sample: PointerSample) => void>();

  constructor(private readonly video: HTMLVideoElement) {}

  async start(): Promise<void> {
    this.landmarker ??= await createLandmarker();
    if (this.frameRequest === null) this.scheduleFrame();
  }

  stop(): void {
    if (this.frameRequest !== null) this.video.cancelVideoFrameCallback(this.frameRequest);
    this.frameRequest = null;
  }

  onSample(listener: (sample: PointerSample) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private scheduleFrame(): void {
    this.frameRequest = this.video.requestVideoFrameCallback((now) => {
      // Reschedule first so one failed frame does not end tracking.
      this.scheduleFrame();
      this.processFrame(now);
    });
  }

  private processFrame(now: number): void {
    if (!this.landmarker) return;
    const result = this.landmarker.detectForVideo(this.video, now);
    const sample = toPointerSample(result.landmarks[0], now);
    this.listeners.forEach((listener) => listener(sample));
  }
}
