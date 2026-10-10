import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { GazeProvider, GazeSample, HeadPose, Point2, Unsubscribe } from '@iris/protocol';
import { ClosureTimer, holdThroughBlink, irisPoints, toGazeSample, type FaceFrame } from './eye-feature';

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
  /** The last sample with an eye reading, held through blinks. */
  private lastSeen: GazeSample | null = null;
  private readonly closure = new ClosureTimer();
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
      // No face: publish a null eye so listeners do not keep aiming at the last
      // sample, and open eyes so a missing face never reads as a double blink.
      this.publish({ t: now, eye: null, head: this.lastHead, blink: { left: 0, right: 0 } });
      this.traceListeners.forEach((listener) => listener([[], []]));
      return;
    }
    const blendshapes: Record<string, number> = {};
    for (const c of result.faceBlendshapes[0]?.categories ?? []) blendshapes[c.categoryName] = c.score;
    // A blink is not a closed eye: hold the last eye reading and the markers through it, but report
    // the closure so a double blink can be seen.
    if (this.closure.blinking(blendshapes, now)) {
      if (this.lastSeen) this.publish(holdThroughBlink(this.lastSeen, blendshapes, now));
      return;
    }
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
    if (sample.eye) this.lastSeen = sample;
    this.sampleListeners.forEach((listener) => listener(sample));
  }
}
