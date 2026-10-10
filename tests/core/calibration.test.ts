import { describe, expect, it } from 'vitest';
import { applyCalibration, fitCalibration, type CalibrationSample } from '@iris/core';
import type { HeadPose, Point2 } from '@iris/protocol';

const VIEWPORT = { width: 1000, height: 600 };
const LEVEL: HeadPose = { yaw: 0, pitch: 0, eyes: { x: 0.5, y: 0.5 }, eyeSpan: 0.2 };
// Geometry the head correction assumes, restated here so the tests do not read it from the code.
const EYE_SPAN_CM = 9;
const DISTANCE_CM = 60;
const PX_PER_CM = 96 / 2.54;
const CM_PER_UNIT = EYE_SPAN_CM / LEVEL.eyeSpan;
const DOTS = [
  { x: 0.5, y: 0.5 },
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
];

/** Eye position a simulated user would show while looking at `target` with a still head. */
function eyeFor(target: Point2): Point2 {
  return { x: (target.x - 0.5) * 0.8, y: (target.y - 0.5) * 0.6 };
}

function samplesFor(noise = 0, perDot = 20): CalibrationSample[] {
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  return DOTS.flatMap((target) =>
    Array.from({ length: perDot }, () => {
      const eye = eyeFor(target);
      return { eye: { x: eye.x + random() * noise, y: eye.y + random() * noise }, head: LEVEL, target };
    }),
  );
}

describe('fitCalibration', () => {
  it('recovers the screen point for each calibration dot', () => {
    const model = fitCalibration(samplesFor());
    for (const dot of DOTS) {
      const point = applyCalibration(model, eyeFor(dot), LEVEL, VIEWPORT);
      expect(point.x).toBeCloseTo(dot.x, 2);
      expect(point.y).toBeCloseTo(dot.y, 2);
    }
  });

  it('predicts points between the dots', () => {
    const model = fitCalibration(samplesFor());
    const point = applyCalibration(model, eyeFor({ x: 0.3, y: 0.7 }), LEVEL, VIEWPORT);
    expect(point.x).toBeCloseTo(0.3, 2);
    expect(point.y).toBeCloseTo(0.7, 2);
  });

  it('stays close under sensor noise', () => {
    const model = fitCalibration(samplesFor(0.02));
    const point = applyCalibration(model, eyeFor({ x: 0.9, y: 0.1 }), LEVEL, VIEWPORT);
    expect(Math.abs(point.x - 0.9)).toBeLessThan(0.05);
    expect(Math.abs(point.y - 0.1)).toBeLessThan(0.05);
  });

  it('ignores glances away from a dot', () => {
    const samples = samplesFor();
    const centerSamples = samples.filter((s) => s.target.x === 0.5);
    centerSamples.slice(0, 3).forEach((s) => (s.eye = { x: 1, y: 1 }));
    const point = applyCalibration(fitCalibration(samples), eyeFor({ x: 0.5, y: 0.5 }), LEVEL, VIEWPORT);
    expect(point.x).toBeCloseTo(0.5, 2);
    expect(point.y).toBeCloseTo(0.5, 2);
  });

  it('holds the point when the head slides sideways after calibration', () => {
    const model = fitCalibration(samplesFor());
    const target = { x: 0.6, y: 0.4 };
    const movedRightCm = 5;
    // The face now sits to the image left (image x grows toward the user's left),
    // and the eyes turn left to keep the target, which a still-head fit reads as a
    // point 5 cm to the left.
    const head = { ...LEVEL, eyes: { x: LEVEL.eyes.x - movedRightCm / CM_PER_UNIT, y: LEVEL.eyes.y } };
    const seen = { x: target.x - (movedRightCm * PX_PER_CM) / VIEWPORT.width, y: target.y };
    const point = applyCalibration(model, eyeFor(seen), head, VIEWPORT);
    expect(point.x).toBeCloseTo(target.x, 2);
    expect(point.y).toBeCloseTo(target.y, 2);
  });

  it('holds the point when the head turns after calibration', () => {
    const model = fitCalibration(samplesFor());
    const target = { x: 0.3, y: 0.7 };
    const head = { ...LEVEL, yaw: 0.15, pitch: 0.1 }; // turned to the user's left and tilted down
    // The eyes counter-turn (right and up), which a still-head fit reads as a point
    // distance times tangent away in those directions.
    const seen = {
      x: target.x + (DISTANCE_CM * Math.tan(0.15) * PX_PER_CM) / VIEWPORT.width,
      y: target.y - (DISTANCE_CM * Math.tan(0.1) * PX_PER_CM) / VIEWPORT.height,
    };
    const point = applyCalibration(model, eyeFor(seen), head, VIEWPORT);
    expect(point.x).toBeCloseTo(target.x, 2);
    expect(point.y).toBeCloseTo(target.y, 2);
  });

  it('applies no head correction when the eye corners were not seen', () => {
    const model = fitCalibration(samplesFor());
    const unknown = { ...LEVEL, yaw: 0.3, eyes: { x: 0.1, y: 0.1 }, eyeSpan: 0 };
    const point = applyCalibration(model, eyeFor({ x: 0.3, y: 0.7 }), unknown, VIEWPORT);
    expect(point.x).toBeCloseTo(0.3, 2);
    expect(point.y).toBeCloseTo(0.7, 2);
  });

  it('clamps predictions to the viewport', () => {
    const model = fitCalibration(samplesFor());
    expect(applyCalibration(model, { x: 5, y: -5 }, LEVEL, VIEWPORT)).toEqual({ x: 1, y: 0 });
  });

  it('rejects calibration with too few dots', () => {
    const twoDots = samplesFor().filter((s) => s.target.x === 0.5 || s.target.y === 0.1 && s.target.x === 0.1);
    expect(() => fitCalibration(twoDots)).toThrow(/at least 3/);
  });
});

describe('fitCalibration with 9 dots', () => {
  const NINE = [0.1, 0.5, 0.9].flatMap((y) => [0.1, 0.5, 0.9].map((x) => ({ x, y })));
  // A webcam below the screen sees vertical eye travel unevenly and horizontal
  // travel shrink toward the top, so the eye-to-screen map curves.
  const curvedEye = (t: { x: number; y: number }) => ({
    x: (t.x - 0.5) * 0.8 * (1 + 0.3 * (t.y - 0.5)),
    y: (t.y - 0.5) * 0.6 + 0.4 * (t.y - 0.5) ** 2,
  });
  const samples = NINE.flatMap((target) =>
    Array.from({ length: 10 }, () => ({ eye: curvedEye(target), head: LEVEL, target })),
  );

  it('switches to curved terms and fits a curved mapping better than 5 dots', () => {
    const nine = fitCalibration(samples);
    const five = fitCalibration(samples.filter((s) => s.target.x === 0.5 ? s.target.y === 0.5 : s.target.y !== 0.5));
    expect(nine.quadratic).toBe(true);
    const check = { x: 0.3, y: 0.8 };
    const error = (model: typeof nine) => {
      const p = applyCalibration(model, curvedEye(check), LEVEL, VIEWPORT);
      return Math.hypot(p.x - check.x, p.y - check.y);
    };
    expect(error(nine)).toBeLessThan(0.03);
    expect(error(nine)).toBeLessThan(error(five));
  });

  it('keeps a straight mapping with only 5 dots', () => {
    expect(fitCalibration(samplesFor()).quadratic).toBe(false);
  });
});
