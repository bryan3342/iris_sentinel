import { describe, expect, it } from 'vitest';
import type { Point2 } from '@iris/protocol';
import { INDEX_TIP, MIDDLE_BASE, THUMB_TIP, toPointerSample, WRIST } from '../../extension/src/providers/mediapipe/hand-feature';

/** 21 hand landmarks, all at one spot except those given. */
const hand = (points: Record<number, Point2>): Point2[] =>
  Array.from({ length: 21 }, (_, i) => points[i] ?? { x: 0.5, y: 0.6 });

describe('toPointerSample', () => {
  it("reports the index fingertip with x toward the user's right", () => {
    // Image x 0.3 is on the image's left, which is the user's right.
    expect(toPointerSample(hand({ [INDEX_TIP]: { x: 0.3, y: 0.4 } }), 7).tip).toEqual({ x: 0.7, y: 0.4 });
  });

  it('measures the gap between thumb and index fingertips in palm lengths, so hand size and distance do not matter', () => {
    // Wrist to middle knuckle is 0.2 of the view; the fingertips are 0.05 apart, a quarter of that.
    const points = { [WRIST]: { x: 0.5, y: 0.8 }, [MIDDLE_BASE]: { x: 0.5, y: 0.6 }, [THUMB_TIP]: { x: 0.4, y: 0.5 }, [INDEX_TIP]: { x: 0.45, y: 0.5 } };
    expect(toPointerSample(hand(points), 7).gap).toBeCloseTo(0.25);
  });

  it('reports no tip and no gap when no hand is in view', () => {
    expect(toPointerSample(undefined, 7)).toEqual({ t: 7, tip: null, gap: null });
  });
});
