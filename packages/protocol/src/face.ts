import type { Unsubscribe } from './common';

/**
 * Face sensing contract for slow trends: natural blinks for the fatigue score,
 * and whether the camera view is good enough to trust body signals. Implemented
 * by the Presage companion (and a simulated provider); callers never see vendor
 * types. Deliberate long blinks for confirms come from GazeProvider instead.
 */

/** One natural blink. */
export interface BlinkEvent {
  /** Monotonic timestamp in milliseconds, stamped by Iris when the blink arrives. */
  t: number;
  /** How long the lids were shut, in milliseconds. */
  durationMs: number;
}

/**
 * How usable the camera view is, and if not, the main thing to fix.
 * `reposition` covers a face that is off-center, too close, too far or turned away.
 */
export const QUALITIES = [
  'ok',
  'no-face',
  'multiple-faces',
  'reposition',
  'too-dark',
  'too-bright',
  'chest-not-visible',
  'motion',
  'camera-adjusting',
  'low-frame-rate',
] as const;
export type Quality = (typeof QUALITIES)[number];

export interface QualityStatus {
  /** Monotonic timestamp in milliseconds, stamped by Iris when the status arrives. */
  t: number;
  quality: Quality;
  /** Short advice for the user, shown as written, for example "Move closer". May be empty. */
  hint: string;
}

export interface FaceProvider {
  start(): Promise<void>;
  stop(): void;
  onBlink(listener: (blink: BlinkEvent) => void): Unsubscribe;
  /** Called when the quality changes, not on every frame. */
  onQuality(listener: (status: QualityStatus) => void): Unsubscribe;
}
