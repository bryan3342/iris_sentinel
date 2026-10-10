import type { Point2, Unsubscribe } from './face';

/**
 * Gaze sensing contract: where the user is looking, before calibration maps it
 * to the screen. Implemented by MediaPipe (and a simulated provider); callers
 * never see vendor types. Blinks and talking come from FaceProvider instead.
 */

export interface HeadPose {
  /** Head turn in radians, positive toward the user's left. */
  yaw: number;
  /** Head tilt in radians, positive downward. */
  pitch: number;
  /** Midpoint of the outer eye corners, in the same image units as the eye feature. */
  eyes: Point2;
  /** Distance between the outer eye corners, same units. Shrinks as the user moves away. */
  eyeSpan: number;
}

export interface GazeSample {
  /** Monotonic timestamp in milliseconds. */
  t: number;
  /**
   * Eye-in-head gaze feature, roughly -1..1 on each axis (positive x is the
   * user's right, positive y is down). Null when no face is visible or both
   * eyes are closed. Calibration maps this to screen coordinates.
   */
  eye: Point2 | null;
  head: HeadPose;
}

export interface GazeProvider {
  start(): Promise<void>;
  stop(): void;
  onSample(listener: (sample: GazeSample) => void): Unsubscribe;
}
