import { describe, expect, it } from 'vitest';
import type { Point2 } from '@iris/protocol';
import { ClosureTimer, type FaceFrame, holdThroughBlink, irisPoints, toGazeSample } from '../../extension/src/providers/mediapipe/eye-feature';

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

/** The whole eye moved by an image offset, iris staying centered: the head moved, the gaze did not. */
const move = (eye: EyeShape, by: Point2): EyeShape => ({
  corners: [{ x: eye.corners[0].x + by.x, y: eye.corners[0].y + by.y }, { x: eye.corners[1].x + by.x, y: eye.corners[1].y + by.y }],
});

/** 4x4 transform with rotation `r` (3x3, row-indexed) and translation `t`, in either layout. */
const columnMajor = (r: number[][], t: [number, number, number]) =>
  [0, 1, 2].flatMap((col) => [r[0]![col]!, r[1]![col]!, r[2]![col]!, 0]).concat([...t, 1]);
const rowMajor = (r: number[][], t: [number, number, number]) =>
  [0, 1, 2].flatMap((row) => [...r[row]!, t[row]!]).concat([0, 0, 0, 1]);
const aboutVertical = (a: number) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const aboutHorizontal = (a: number) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const withMatrix = (matrix: number[]): FaceFrame => ({ ...frame(), matrix });

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

  it("reports each eye's closure by the user's own left and right", () => {
    expect(toGazeSample(frame({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.2 }), 0).blink).toEqual({ left: 0.9, right: 0.2 });
  });

  it('still reports closure when both eyes are shut and the position drops out', () => {
    const sample = toGazeSample(frame({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.8 }), 0);
    expect(sample.eye).toBeNull();
    expect(sample.blink).toEqual({ left: 0.9, right: 0.8 });
  });

  it('reads missing blink scores as open eyes', () => {
    expect(toGazeSample(frame(), 0).blink).toEqual({ left: 0, right: 0 });
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

  it('reads a turn about the vertical axis as yaw and a tilt about the horizontal axis as pitch', () => {
    const turned = toGazeSample(withMatrix(columnMajor(aboutVertical(0.2), [0, 0, -60])), 0).head;
    expect(turned.yaw).toBeCloseTo(0.2);
    expect(turned.pitch).toBeCloseTo(0);
    const tilted = toGazeSample(withMatrix(columnMajor(aboutHorizontal(0.1), [0, 0, -60])), 0).head;
    expect(tilted.pitch).toBeCloseTo(0.1);
    expect(tilted.yaw).toBeCloseTo(0);
  });

  it('reads the same pose whether the matrix is column-major or row-major', () => {
    const [r, t] = [aboutVertical(0.2), [1, 2, -60] as [number, number, number]];
    const a = toGazeSample(withMatrix(columnMajor(r, t)), 0).head;
    const b = toGazeSample(withMatrix(rowMajor(r, t)), 0).head;
    expect(b.yaw).toBeCloseTo(a.yaw);
    expect(b.pitch).toBeCloseTo(a.pitch);
  });

  it('places the head at the outer eye corners', () => {
    const { head } = toGazeSample(frame(), 0);
    expect(head.eyes).toEqual({ x: 0.5, y: 0.4 });
    expect(head.eyeSpan).toBeCloseTo(0.4);
  });

  it('moves the head position, not the eye feature, when the whole face shifts', () => {
    const by = { x: 0.1, y: 0.05 };
    const { eye, head } = toGazeSample(frame({}, { right: move(RIGHT, by), left: move(LEFT, by) }), 0);
    expect(eye?.x).toBeCloseTo(0);
    expect(eye?.y).toBeCloseTo(0);
    expect(head.eyes.x).toBeCloseTo(0.6);
    expect(head.eyes.y).toBeCloseTo(0.45);
    expect(head.eyeSpan).toBeCloseTo(0.4);
  });

  it('lists iris points for open eyes only', () => {
    expect(irisPoints(frame()).map((eye) => eye.length)).toEqual([5, 5]);
    expect(irisPoints(frame({ eyeBlinkLeft: 0.9 })).map((eye) => eye.length)).toEqual([5, 0]);
    expect(irisPoints(frame({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 })).map((eye) => eye.length)).toEqual([0, 0]);
  });

  it('reports no head position when the eye corners are missing', () => {
    const empty: FaceFrame = { landmarks: [], blendshapes: {}, matrix: IDENTITY, aspect: 1 };
    expect(toGazeSample(empty, 0).head.eyeSpan).toBe(0);
  });

  it('returns no eye position when landmarks are missing', () => {
    const empty: FaceFrame = { landmarks: [], blendshapes: {}, matrix: IDENTITY, aspect: 1 };
    expect(toGazeSample(empty, 5)).toMatchObject({ t: 5, eye: null });
  });
});

describe('ClosureTimer', () => {
  const open = {};
  const shut = { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 };

  it('treats a short closure as a blink and a long one as closed eyes', () => {
    const timer = new ClosureTimer();
    expect(timer.blinking(open, 0)).toBe(false);
    expect(timer.blinking(shut, 100)).toBe(true);
    expect(timer.blinking(shut, 350)).toBe(true);
    expect(timer.blinking(shut, 600)).toBe(false);
  });

  it('still recognises a blink of the open eye while the other eye is held closed', () => {
    const timer = new ClosureTimer();
    const leftHeld = { eyeBlinkLeft: 0.9 };
    timer.blinking(leftHeld, 0);
    expect(timer.blinking(leftHeld, 700)).toBe(false); // left is closed, right is tracking
    expect(timer.blinking(shut, 800)).toBe(true); // right blinks: hold
    expect(timer.blinking(shut, 1000)).toBe(true);
    expect(timer.blinking(leftHeld, 1100)).toBe(false); // right reopened: back to one-eye tracking
    expect(timer.blinking(shut, 1700)).toBe(true); // right shuts again: a blink until proven longer
    expect(timer.blinking(shut, 2200)).toBe(false); // right held shut too: both closed
  });

  it('starts timing again after the eyes reopen', () => {
    const timer = new ClosureTimer();
    timer.blinking(shut, 0);
    expect(timer.blinking(shut, 700)).toBe(false);
    expect(timer.blinking(open, 800)).toBe(false);
    expect(timer.blinking({ eyeBlinkLeft: 0.9 }, 900)).toBe(true);
  });
});

describe('holdThroughBlink', () => {
  it('keeps the last eye reading and head still while reporting the closed lids, so blinks can be counted', () => {
    const last = { t: 100, eye: { x: 0.1, y: -0.2 }, head: { yaw: 0.1, pitch: 0, eyes: { x: 0.5, y: 0.5 }, eyeSpan: 0.2 }, blink: { left: 0.02, right: 0.03 } };
    const held = holdThroughBlink(last, { eyeBlinkLeft: 0.92, eyeBlinkRight: 0.88 }, 133);
    expect(held).toEqual({ ...last, t: 133, blink: { left: 0.92, right: 0.88 } });
  });
});
