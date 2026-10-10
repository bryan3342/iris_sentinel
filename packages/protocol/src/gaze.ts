import type { Point2, Unsubscribe } from './common';

/**
 * Gaze sensing contract: where the user is looking, before calibration maps it
 * to the screen, and how closed each eye is. Implemented by MediaPipe (and a
 * simulated provider); callers never see vendor types. Natural blink rate for
 * fatigue comes from the Presage FaceProvider, and talking from the voice agent.
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
  /**
   * Closure of the user's own left and right eye, 0 (open) to 1 (closed).
   * Drives the double-blink confirm. Reads as open when no face is visible, so a
   * missing face can never look like a double blink.
   */
  blink: { left: number; right: number };
}

export interface GazeProvider {
  start(): Promise<void>;
  stop(): void;
  onSample(listener: (sample: GazeSample) => void): Unsubscribe;
}
