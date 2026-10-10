import { describe, expect, it } from 'vitest';
import type { Point2 } from '@iris/protocol';
import { INDEX_TIP, toPointerSample } from '../../extension/src/providers/mediapipe/hand-feature';

const hand = (tip: Point2): Point2[] => {
  const landmarks: Point2[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6 }));
  landmarks[INDEX_TIP] = tip;
  return landmarks;
};

describe('toPointerSample', () => {
  it('reports the index fingertip with x toward the user\'s right', () => {
    // Image x 0.3 is on the image's left, which is the user's right.
    expect(toPointerSample(hand({ x: 0.3, y: 0.4 }), 7)).toEqual({ t: 7, tip: { x: 0.7, y: 0.4 } });
  });

  it('reports no tip when no hand is in view', () => {
    expect(toPointerSample(undefined, 7)).toEqual({ t: 7, tip: null });
  });
});
