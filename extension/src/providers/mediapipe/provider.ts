import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { GazeProvider, GazeSample, HeadPose, Point2, Unsubscribe } from '@iris/protocol';
import { irisPoints, toGazeSample, type FaceFrame } from './eye-feature';

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

/** GazeProvider backed by MediaPipe Face Landmarker, run on every video frame. */
export class MediaPipeGazeProvider implements GazeProvider {
  private landmarker: FaceLandmarker | null = null;
  private frameRequest: number | null = null;
  private lastHead: HeadPose = { yaw: 0, pitch: 0, eyes: { x: 0, y: 0 }, eyeSpan: 0 };
  private readonly sampleListeners = new Set<(sample: GazeSample) => void>();
  private readonly traceListeners = new Set<(eyes: [Point2[], Point2[]]) => void>();

  constructor(private readonly video: HTMLVideoElement) {}

  async start(): Promise<void> {
    this.landmarker ??= await createLandmarker();
    if (this.frameRequest === null) this.scheduleFrame();
  }

  stop(): void {
    if (this.frameRequest !== null) this.video.cancelVideoFrameCallback(this.frameRequest);
    this.frameRequest = null;
  }

  onSample(listener: (sample: GazeSample) => void): Unsubscribe {
    this.sampleListeners.add(listener);
    return () => this.sampleListeners.delete(listener);
  }

  /** Iris points per eye (user's right, then left) for the on-screen trace; empty for a closed eye. */
  onTracePoints(listener: (eyes: [Point2[], Point2[]]) => void): Unsubscribe {
    this.traceListeners.add(listener);
    return () => this.traceListeners.delete(listener);
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
    const landmarks = result.faceLandmarks[0];
    if (!landmarks) {
      // No face: publish a null eye so listeners do not keep aiming at the last sample.
      this.publish({ t: now, eye: null, head: this.lastHead });
      this.traceListeners.forEach((listener) => listener([[], []]));
      return;
    }
    const blendshapes: Record<string, number> = {};
    for (const c of result.faceBlendshapes[0]?.categories ?? []) blendshapes[c.categoryName] = c.score;
    const frame: FaceFrame = {
      landmarks,
      blendshapes,
      matrix: result.facialTransformationMatrixes[0]?.data ?? [],
      aspect: this.video.videoWidth / this.video.videoHeight,
    };
    this.publish(toGazeSample(frame, now));
    const eyes = irisPoints(frame);
    this.traceListeners.forEach((listener) => listener(eyes));
  }

  private publish(sample: GazeSample): void {
    this.lastHead = sample.head;
    this.sampleListeners.forEach((listener) => listener(sample));
  }
}
