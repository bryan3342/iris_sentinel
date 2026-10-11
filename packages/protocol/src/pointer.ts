import type { Point2, Unsubscribe } from './common';

/**
 * Hand pointing contract: where the user's index fingertip is in the camera
 * view, before the trackpad map turns it into a page point, and how far apart
 * the thumb and index fingertips are, for a pinch. Implemented by MediaPipe;
 * callers never see vendor types. Like face landmarks, none of it leaves the
 * computer.
 */

export interface PointerSample {
  /** Monotonic timestamp in milliseconds, on the same clock as gaze samples. */
  t: number;
  /**
   * Index fingertip as a fraction of the camera view, x growing toward the
   * user's right and y down. Null when no hand is in view.
   */
  tip: Point2 | null;
  /**
   * Gap between the thumb and index fingertips in palm lengths (wrist to
   * middle knuckle): about 0 when they touch. Null when no hand is in view.
   */
  gap: number | null;
}

export interface PointerProvider {
  start(): Promise<void>;
  stop(): void;
  onSample(listener: (sample: PointerSample) => void): Unsubscribe;
}
