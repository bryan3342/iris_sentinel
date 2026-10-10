import { describe, expect, it } from 'vitest';
import type { Point2 } from '@iris/protocol';
import { type FaceFrame, toFaceSample } from '../../extension/src/providers/mediapipe/eye-feature';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A face with level eyes; `irisShift` moves both irises in image coordinates. */
function frame(irisShift: Point2 = { x: 0, y: 0 }, blendshapes: Record<string, number> = {}): FaceFrame {
  const landmarks: Point2[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const place = (i: number, x: number, y: number) => (landmarks[i] = { x, y });
  place(33, 0.3, 0.4); // user's right eye, outer corner
  place(133, 0.4, 0.4); // user's right eye, inner corner
  place(468, 0.35 + irisShift.x, 0.4 + irisShift.y);
  place(362, 0.6, 0.4); // user's left eye, inner corner
  place(263, 0.7, 0.4); // user's left eye, outer corner
  place(473, 0.65 + irisShift.x, 0.4 + irisShift.y);
  return { landmarks, blendshapes, matrix: IDENTITY, aspect: 1 };
}

describe('toFaceSample', () => {
  it('reads centered irises as looking straight ahead', () => {
    const { eye } = toFaceSample(frame(), 0);
    expect(eye?.x).toBeCloseTo(0);
    expect(eye?.y).toBeCloseTo(0);
  });

  it('reports positive x when the user looks to their right (image left)', () => {
    expect(toFaceSample(frame({ x: -0.02, y: 0 }), 0).eye?.x).toBeGreaterThan(0);
  });

  it('reports positive y when the irises sit below the eye corners', () => {
    expect(toFaceSample(frame({ x: 0, y: 0.01 }), 0).eye?.y).toBeGreaterThan(0);
  });

  it('drops the eye position while both eyes are closed', () => {
    const sample = toFaceSample(frame(undefined, { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.8 }), 0);
    expect(sample.eye).toBeNull();
    expect(sample.blink).toEqual({ left: 0.9, right: 0.8 });
  });

  it('keeps tracking through a one-eye wink', () => {
    expect(toFaceSample(frame(undefined, { eyeBlinkLeft: 0.9 }), 0).eye).not.toBeNull();
  });

  it('flags talking from an open jaw', () => {
    expect(toFaceSample(frame(undefined, { jawOpen: 0.4 }), 0).talking).toBe(true);
    expect(toFaceSample(frame(undefined, { jawOpen: 0.05 }), 0).talking).toBe(false);
  });

  it('reads a level head from the identity transform', () => {
    const { head } = toFaceSample(frame(), 0);
    expect(head.yaw).toBeCloseTo(0);
    expect(head.pitch).toBeCloseTo(0);
  });

  it('returns no eye position when landmarks are missing', () => {
    const empty: FaceFrame = { landmarks: [], blendshapes: {}, matrix: IDENTITY, aspect: 1 };
    expect(toFaceSample(empty, 5)).toMatchObject({ t: 5, eye: null });
  });
});
