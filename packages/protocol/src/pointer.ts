import type { Point2, Unsubscribe } from './face';

/**
 * Hand pointing contract: where the user's index fingertip is in the camera
 * view, before the trackpad map turns it into a screen point. Implemented by
 * MediaPipe (and a simulated provider); callers never see vendor types.
 */

export interface PointerSample {
  /** Monotonic timestamp in milliseconds. */
  t: number;
  /**
   * Index fingertip as a fraction of the camera view, x growing toward the
   * user's right and y down. Null when no hand is in view.
   */
  tip: Point2 | null;
}

export interface PointerProvider {
  start(): Promise<void>;
  stop(): void;
  onSample(listener: (sample: PointerSample) => void): Unsubscribe;
}
