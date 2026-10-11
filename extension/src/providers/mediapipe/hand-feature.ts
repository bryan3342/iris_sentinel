import type { Point2, PointerSample } from '@iris/protocol';

// Pure conversion from Hand Landmarker output to a neutral PointerSample. Kept
// free of MediaPipe imports so it can be unit tested with plain fixtures.

/** Indices among MediaPipe's 21 hand landmarks. */
export const WRIST = 0;
export const THUMB_TIP = 4;
export const INDEX_TIP = 8;
/** The middle finger's knuckle: the wrist to here is the palm length the pinch gap is measured in. */
export const MIDDLE_BASE = 9;

const distance = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The first hand in view as a pointer sample, or no tip and no gap without
 * one. Image x grows toward the user's left (the camera faces them), so the
 * fingertip is flipped: positive x is the user's right, matching the gaze
 * feature. The pinch gap is in palm lengths, so it reads the same for any hand
 * size or distance from the camera.
 */
export function toPointerSample(hand: Point2[] | undefined, t: number): PointerSample {
  const tip = hand?.[INDEX_TIP];
  if (!hand || !tip) return { t, tip: null, gap: null };
  const palm = distance(hand[WRIST]!, hand[MIDDLE_BASE]!);
  return { t, tip: { x: 1 - tip.x, y: tip.y }, gap: palm > 0 ? distance(hand[THUMB_TIP]!, tip) / palm : null };
}
