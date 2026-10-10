import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceProvider, FaceSample, Unsubscribe } from '@iris/protocol';
import { toFaceSample } from './eye-feature';

// WASM and model are bundled by scripts/setup-mediapipe.mjs; nothing loads remotely.
async function createLandmarker(): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
}

/** FaceProvider backed by MediaPipe Face Landmarker, run on every video frame. */
export class MediaPipeFaceProvider implements FaceProvider {
  private landmarker: FaceLandmarker | null = null;
  private frameRequest: number | null = null;
  private readonly sampleListeners = new Set<(sample: FaceSample) => void>();

  constructor(private readonly video: HTMLVideoElement) {}

  async start(): Promise<void> {
    this.landmarker ??= await createLandmarker();
    if (this.frameRequest === null) this.scheduleFrame();
  }

  stop(): void {
    if (this.frameRequest !== null) this.video.cancelVideoFrameCallback(this.frameRequest);
    this.frameRequest = null;
  }

  onSample(listener: (sample: FaceSample) => void): Unsubscribe {
    this.sampleListeners.add(listener);
    return () => this.sampleListeners.delete(listener);
  }

  private scheduleFrame(): void {
    this.frameRequest = this.video.requestVideoFrameCallback((now) => {
      this.processFrame(now);
      if (this.frameRequest !== null) this.scheduleFrame();
    });
  }

  private processFrame(now: number): void {
    if (!this.landmarker) return;
    const result = this.landmarker.detectForVideo(this.video, now);
    const landmarks = result.faceLandmarks[0];
    if (!landmarks) return;
    const blendshapes: Record<string, number> = {};
    for (const c of result.faceBlendshapes[0]?.categories ?? []) blendshapes[c.categoryName] = c.score;
    const sample = toFaceSample(
      {
        landmarks,
        blendshapes,
        matrix: result.facialTransformationMatrixes[0]?.data ?? [],
        aspect: this.video.videoWidth / this.video.videoHeight,
      },
      now,
    );
    this.sampleListeners.forEach((listener) => listener(sample));
  }
}
