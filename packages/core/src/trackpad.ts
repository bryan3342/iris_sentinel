import type { Point2 } from '@iris/protocol';

/**
 * Maps the fingertip's position in the camera view to the screen the way a
 * trackpad maps a finger to a cursor: a small box in front of the user covers
 * the whole viewport, so a few centimetres of hand travel sweep the screen.
 * Outside the box the pointer sticks to the nearest edge.
 */
export interface TrackpadBox {
  /** Camera-view fractions (x toward the user's right, y down) that land on the viewport's top-left. */
  min: Point2;
  /** Camera-view fractions that land on the viewport's bottom-right. */
  max: Point2;
}

// A box around the middle of the view, a little low, where a hand rests when
// the elbow is on the desk. Users who can move less get a smaller box later.
export const DEFAULT_TRACKPAD_BOX: TrackpadBox = { min: { x: 0.3, y: 0.35 }, max: { x: 0.7, y: 0.8 } };

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** Screen point (fraction of the viewport, clamped to 0..1) for a fingertip in the camera view. */
export function trackpadToScreen(tip: Point2, box: TrackpadBox = DEFAULT_TRACKPAD_BOX): Point2 {
  return {
    x: clamp((tip.x - box.min.x) / (box.max.x - box.min.x)),
    y: clamp((tip.y - box.min.y) / (box.max.y - box.min.y)),
  };
}
