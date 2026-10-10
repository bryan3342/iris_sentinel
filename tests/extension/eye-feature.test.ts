import { describe, expect, it } from 'vitest';
import type { Point2 } from '@iris/protocol';
import { type FaceFrame, toGazeSample } from '../../extension/src/providers/mediapipe/eye-feature';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A face with level eyes; `irisShift` moves both irises in image coordinates. */
function frame(irisShift: Point2 = { x: 0, y: 0 }, blendshapes: Record<string, number> = {}): FaceFrame {
  const landmarks: Point2[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const place = (i: number, x: number, y: number) => (landmarks[i] = { x, y });
  const placeIris = (center: number, x: number, y: number) => {
    place(center, x, y);
    [[0.005, 0], [0, -0.005], [-0.005, 0], [0, 0.005]].forEach(([dx, dy], k) => place(center + 1 + k, x + dx!, y + dy!));
  };
  place(33, 0.3, 0.4); // user's right eye, outer corner
  place(133, 0.4, 0.4); // user's right eye, inner corner
  placeIris(468, 0.35 + irisShift.x, 0.4 + irisShift.y);
  place(362, 0.6, 0.4); // user's left eye, inner corner
  place(263, 0.7, 0.4); // user's left eye, outer corner
  placeIris(473, 0.65 + irisShift.x, 0.4 + irisShift.y);
  return { landmarks, blendshapes, matrix: IDENTITY, aspect: 1 };
}

describe('toGazeSample', () => {
  it('reads centered irises as looking straight ahead', () => {
    const { eye } = toGazeSample(frame(), 0);
    expect(eye?.x).toBeCloseTo(0);
    expect(eye?.y).toBeCloseTo(0);
  });

  it('reports positive x when the user looks to their right (image left)', () => {
    expect(toGazeSample(frame({ x: -0.02, y: 0 }), 0).eye?.x).toBeGreaterThan(0);
  });

  it('reports positive y when the irises sit below the eye corners', () => {
    expect(toGazeSample(frame({ x: 0, y: 0.01 }), 0).eye?.y).toBeGreaterThan(0);
  });

  it('blends look-down scores into the vertical position', () => {
    const down = toGazeSample(frame(undefined, { eyeLookDownLeft: 0.6, eyeLookDownRight: 0.6 }), 0);
    const up = toGazeSample(frame(undefined, { eyeLookUpLeft: 0.6, eyeLookUpRight: 0.6 }), 0);
    expect(down.eye?.y).toBeGreaterThan(0);
    expect(up.eye?.y).toBeLessThan(0);
  });

  it('drops the eye position while both eyes are closed', () => {
    expect(toGazeSample(frame(undefined, { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.8 }), 0).eye).toBeNull();
  });

  it('keeps tracking through a one-eye wink', () => {
    expect(toGazeSample(frame(undefined, { eyeBlinkLeft: 0.9 }), 0).eye).not.toBeNull();
  });

  it('reads a level head from the identity transform', () => {
    const { head } = toGazeSample(frame(), 0);
    expect(head.yaw).toBeCloseTo(0);
    expect(head.pitch).toBeCloseTo(0);
  });

  it('returns no eye position when landmarks are missing', () => {
    const empty: FaceFrame = { landmarks: [], blendshapes: {}, matrix: IDENTITY, aspect: 1 };
    expect(toGazeSample(empty, 5)).toMatchObject({ t: 5, eye: null });
  });
});
