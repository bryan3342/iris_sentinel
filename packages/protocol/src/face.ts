/**
 * Face sensing contract shared by every face provider (MediaPipe, Presage,
 * simulated). Providers publish normalized samples; callers never see vendor
 * types.
 */

export interface Point2 {
  x: number;
  y: number;
}

export interface FaceSample {
  /** Monotonic timestamp in milliseconds. */
  t: number;
  /**
   * Eye-in-head gaze feature, roughly -1..1 on each axis (positive x is the
   * user's right, positive y is down). Null when no face is visible or both
   * eyes are closed. Calibration maps this to screen coordinates.
   */
  eye: Point2 | null;
  /** Head rotation in radians. */
  head: { yaw: number; pitch: number };
  /** Eye closure per eye, 0 (open) to 1 (closed). */
  blink: { left: number; right: number };
  talking: boolean;
}

export type Unsubscribe = () => void;

export interface FaceProvider {
  start(): Promise<void>;
  stop(): void;
  onSample(listener: (sample: FaceSample) => void): Unsubscribe;
}
