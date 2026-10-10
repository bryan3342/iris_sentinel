import { describe, expect, it } from 'vitest';
import type { Point2 } from '@iris/protocol';
import { type FaceFrame, toGazeSample } from '../../extension/src/providers/mediapipe/eye-feature';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

interface EyeShape {
  /** Image-left and image-right corners. */
  corners: [Point2, Point2];
  /** Iris center; defaults to the midpoint of the corners. */
  iris?: Point2;
}

const RIGHT: EyeShape = { corners: [{ x: 0.3, y: 0.4 }, { x: 0.4, y: 0.4 }] }; // user's right eye
const LEFT: EyeShape = { corners: [{ x: 0.6, y: 0.4 }, { x: 0.7, y: 0.4 }] }; // user's left eye

const shift = (eye: EyeShape, by: Point2): EyeShape => {
  const [a, b] = eye.corners;
  return { ...eye, iris: { x: (a.x + b.x) / 2 + by.x, y: (a.y + b.y) / 2 + by.y } };
};

/** A face with level eyes. Pass eye shapes to move an iris or narrow an eye. */
function frame(
  blendshapes: Record<string, number> = {},
  { right = RIGHT, left = LEFT }: { right?: EyeShape; left?: EyeShape } = {},
): FaceFrame {
  const landmarks: Point2[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const place = (i: number, p: Point2) => (landmarks[i] = p);
  const placeEye = (eye: EyeShape, cornerA: number, cornerB: number, irisCenter: number) => {
    const [a, b] = eye.corners;
    place(cornerA, a);
    place(cornerB, b);
    const iris = eye.iris ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    place(irisCenter, iris);
    [[0.005, 0], [0, -0.005], [-0.005, 0], [0, 0.005]].forEach(([dx, dy], k) =>
      place(irisCenter + 1 + k, { x: iris.x + dx!, y: iris.y + dy! }),
    );
  };
  placeEye(right, 33, 133, 468);
  placeEye(left, 362, 263, 473);
  return { landmarks, blendshapes, matrix: IDENTITY, aspect: 1 };
}

/** Both irises moved by the same image offset. */
const both = (by: Point2) => frame({}, { right: shift(RIGHT, by), left: shift(LEFT, by) });

describe('toGazeSample', () => {
  it('reads centered irises as looking straight ahead', () => {
    const { eye } = toGazeSample(frame(), 0);
    expect(eye?.x).toBeCloseTo(0);
    expect(eye?.y).toBeCloseTo(0);
  });

  it('reports positive x when the user looks to their right (image left)', () => {
    expect(toGazeSample(both({ x: -0.02, y: 0 }), 0).eye?.x).toBeGreaterThan(0);
  });

  it('reports positive y when the irises sit below the eye corners', () => {
    expect(toGazeSample(both({ x: 0, y: 0.01 }), 0).eye?.y).toBeGreaterThan(0);
  });

  it('blends look-down scores into the vertical position', () => {
    const down = toGazeSample(frame({ eyeLookDownLeft: 0.6, eyeLookDownRight: 0.6 }), 0);
    const up = toGazeSample(frame({ eyeLookUpLeft: 0.6, eyeLookUpRight: 0.6 }), 0);
    expect(down.eye?.y).toBeGreaterThan(0);
    expect(up.eye?.y).toBeLessThan(0);
  });

  it('drops the eye position while both eyes are closed', () => {
    expect(toGazeSample(frame({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.8 }), 0).eye).toBeNull();
  });

  it('keeps tracking through a one-eye wink', () => {
    expect(toGazeSample(frame({ eyeBlinkLeft: 0.9 }), 0).eye).not.toBeNull();
  });

  it('aims with the open eye alone during a wink', () => {
    const rightLooksRight = { right: shift(RIGHT, { x: -0.02, y: 0 }) };
    const averaged = toGazeSample(frame({}, rightLooksRight), 0).eye!;
    const winked = toGazeSample(frame({ eyeBlinkLeft: 0.9 }, rightLooksRight), 0).eye!;
    expect(winked.x).toBeCloseTo(2 * averaged.x);
  });

  it('pairs look-down scores with their own eye', () => {
    const leftClosed = { eyeBlinkLeft: 0.9 };
    expect(toGazeSample(frame({ ...leftClosed, eyeLookDownLeft: 0.8 }), 0).eye?.y).toBeCloseTo(0);
    expect(toGazeSample(frame({ ...leftClosed, eyeLookDownRight: 0.8 }), 0).eye?.y).toBeGreaterThan(0);
  });

  it('trusts a narrowed eye less than a wide one', () => {
    // Left eye foreshortened to half width, as when the head turns to the user's right.
    const narrowLeft: EyeShape = { corners: [{ x: 0.625, y: 0.4 }, { x: 0.675, y: 0.4 }] };
    // Each iris moved by the same fraction (20%) of its own eye's width.
    const leftMoved = toGazeSample(frame({}, { left: shift(narrowLeft, { x: -0.01, y: 0 }) }), 0).eye!;
    const rightMoved = toGazeSample(frame({}, { right: shift(RIGHT, { x: -0.02, y: 0 }), left: narrowLeft }), 0).eye!;
    expect(leftMoved.x).toBeGreaterThan(0);
    expect(leftMoved.x).toBeLessThan(rightMoved.x);
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
