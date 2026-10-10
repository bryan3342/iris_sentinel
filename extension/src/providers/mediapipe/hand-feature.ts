import type { Point2, PointerSample } from '@iris/protocol';

// Pure conversion from Hand Landmarker output to a neutral PointerSample. Kept
// free of MediaPipe imports so it can be unit tested with plain fixtures.

/** Index of the index fingertip among the 21 hand landmarks. */
export const INDEX_TIP = 8;

/**
 * The fingertip of the first hand in view, or null. Image x grows toward the
 * user's left (the camera faces them), so it is flipped: positive x is the
 * user's right, matching the gaze feature.
 */
export function toPointerSample(hand: Point2[] | undefined, t: number): PointerSample {
  const tip = hand?.[INDEX_TIP];
  return { t, tip: tip ? { x: 1 - tip.x, y: tip.y } : null };
}
