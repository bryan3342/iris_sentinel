import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { readLight, SteadyGaze, type LightAdvice } from '@iris/core';
import type { GazeProvider, GazeSample, HeadPose, Point2, Unsubscribe } from '@iris/protocol';
import { ClosureTimer, faceCenter, holdThroughBlink, irisPoints, pickFace, toGazeSample, type FaceFrame } from './eye-feature';

// WASM and model are bundled by scripts/setup-mediapipe.mjs; nothing loads remotely.
async function createLandmarker(): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 2, // someone else in the picture is told apart from the user (see pickFace)
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
}

const LIGHT_EVERY = 6; // frames between light readings, about five a second
const LIGHT_SIZE = 16; // the face and the picture are each shrunk to this many pixels square to be measured

/**
 * GazeProvider backed by MediaPipe Face Landmarker, run on every video frame. Each sample is
 * steadied (SteadyGaze) before anyone reads it, harder when the light on the face is poor, and the
 * user's face is followed when someone else is in the picture. Pixels are measured here and never
 * leave the computer.
 */
export class MediaPipeGazeProvider implements GazeProvider {
  private landmarker: FaceLandmarker | null = null;
  private frameRequest: number | null = null;
  private lastHead: HeadPose = { yaw: 0, pitch: 0, eyes: { x: 0, y: 0 }, eyeSpan: 0 };
  /** The last sample with an eye reading, held through blinks. */
  private lastSeen: GazeSample | null = null;
  private readonly closure = new ClosureTimer();
  private readonly steady = new SteadyGaze();
  private followed: Point2 | null = null;
  private frames = 0;
  private trust = 1;
  private advice: LightAdvice = null;
  private readonly light = new OffscreenCanvas(LIGHT_SIZE, LIGHT_SIZE).getContext('2d', { willReadFrequently: true });
  private readonly lightListeners = new Set<(advice: LightAdvice) => void>();
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

  /** Told when the light on the face changes enough to matter: too dim, too bright, from behind, or fine (null). */
  onLight(listener: (advice: LightAdvice) => void): Unsubscribe {
    this.lightListeners.add(listener);
    return () => this.lightListeners.delete(listener);
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
    const face = pickFace(result.faceLandmarks, this.followed);
    const landmarks = result.faceLandmarks[face];
    this.followed = landmarks ? faceCenter(landmarks) : null;
    if (!landmarks) {
      // No face: publish a null eye so listeners do not keep aiming at the last
      // sample, and open eyes so a missing face never reads as a double blink.
      this.publish({ t: now, eye: null, head: this.lastHead, blink: { left: 0, right: 0 } });
      this.traceListeners.forEach((listener) => listener([[], []]));
      return;
    }
    const blendshapes: Record<string, number> = {};
    for (const c of result.faceBlendshapes[face]?.categories ?? []) blendshapes[c.categoryName] = c.score;
    if (this.frames++ % LIGHT_EVERY === 0) this.measureLight(landmarks);
    // A blink is not a closed eye: hold the last eye reading and the markers through it, but report
    // the closure so a double blink can be seen.
    if (this.closure.blinking(blendshapes, now)) {
      if (this.lastSeen) this.publish(holdThroughBlink(this.lastSeen, blendshapes, now));
      return;
    }
    const frame: FaceFrame = {
      landmarks,
      blendshapes,
      matrix: result.facialTransformationMatrixes[face]?.data ?? [],
      aspect: this.video.videoWidth / this.video.videoHeight,
    };
    this.publish(this.steady.filter(toGazeSample(frame, now), this.trust));
    const eyes = irisPoints(frame);
    this.traceListeners.forEach((listener) => listener(eyes));
  }

  /** Reads the brightness of the face and of the whole picture, for how far to trust the readings. */
  private measureLight(landmarks: Point2[]): void {
    const context = this.light;
    const { videoWidth: w, videoHeight: h } = this.video;
    if (!context || !w || !h) return;
    const level = (x: number, y: number, width: number, height: number) => {
      context.drawImage(this.video, x, y, Math.max(1, width), Math.max(1, height), 0, 0, LIGHT_SIZE, LIGHT_SIZE);
      const data = context.getImageData(0, 0, LIGHT_SIZE, LIGHT_SIZE).data;
      const values: number[] = [];
      for (let i = 0; i < data.length; i += 4) values.push(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!);
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      return { mean, spread: Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length) };
    };
    const xs = landmarks.map((p) => p.x), ys = landmarks.map((p) => p.y);
    const left = Math.max(0, Math.min(...xs)) * w, top = Math.max(0, Math.min(...ys)) * h;
    const face = level(left, top, Math.min(1, Math.max(...xs)) * w - left, Math.min(1, Math.max(...ys)) * h - top);
    const { trust, advice } = readLight({ face: face.mean, contrast: face.spread, scene: level(0, 0, w, h).mean });
    this.trust = trust;
    if (advice === this.advice) return;
    this.advice = advice;
    this.lightListeners.forEach((listener) => listener(advice));
  }

  private publish(sample: GazeSample): void {
    this.lastHead = sample.head;
    if (sample.eye) this.lastSeen = sample;
    this.sampleListeners.forEach((listener) => listener(sample));
  }
}
