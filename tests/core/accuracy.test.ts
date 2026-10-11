import { describe, expect, it } from 'vitest';
import { fitCalibration, measureAccuracy, visualAngle, type CalibrationSample } from '@iris/core';
import type { HeadPose, Point2 } from '@iris/protocol';

const SCREEN = { width: 1000, height: 600 };
const LEVEL: HeadPose = { yaw: 0, pitch: 0, eyes: { x: 0.5, y: 0.5 }, eyeSpan: 0.2 };
const grid = (p: number[]) => p.flatMap((y) => p.map((x) => ({ x, y })));
const eyeFor = (t: Point2): Point2 => ({ x: (t.x - 0.5) * 0.8, y: (t.y - 0.5) * 0.6 });
const samples = (targets: Point2[], shift: Point2 = { x: 0, y: 0 }, head = LEVEL, perDot = 10): CalibrationSample[] =>
  targets.flatMap((target) => Array.from({ length: perDot }, () => {
    const eye = eyeFor(target);
    return { eye: { x: eye.x + shift.x, y: eye.y + shift.y }, head, target };
  }));
const model = fitCalibration(samples(grid([0.05, 0.5, 0.95]), undefined, undefined, 20), SCREEN);
const CHECK = grid([0.2, 0.5, 0.8]);

describe('measureAccuracy', () => {
  it('reports no error when the fit matches where the user looked', () => {
    const report = measureAccuracy(model, samples(CHECK), SCREEN);
    expect(report.dots).toBe(9);
    expect(report.meanPx).toBeLessThan(1);
    expect(report.worstPx).toBeLessThan(1);
  });

  it('reports a drift in pixels, per direction, and as a share of the screen width', () => {
    // An eye reading 0.04 further right reads as 0.05 of the width (the eye spans 0.8 across the screen).
    const report = measureAccuracy(model, samples(CHECK, { x: 0.04, y: 0 }), SCREEN);
    expect(report.meanPx).toBeCloseTo(50, 0);
    expect(report.meanXPx).toBeCloseTo(50, 0);
    expect(report.meanYPx).toBeLessThan(1);
    expect(report.share).toBeCloseTo(0.05, 2);
  });

  it('takes each dot at its middle reading, so a glance away does not count', () => {
    const glance = samples(CHECK).map((s, i) => (i % 10 === 0 ? { ...s, eye: { x: 0.4, y: 0.3 } } : s));
    expect(measureAccuracy(model, glance, SCREEN).worstPx).toBeLessThan(1);
  });

  it('describes the posture the check was taken in', () => {
    const tilted: HeadPose = { ...LEVEL, pitch: (10 * Math.PI) / 180, yaw: (-5 * Math.PI) / 180 };
    const report = measureAccuracy(model, samples(CHECK, undefined, tilted), SCREEN);
    expect(report.posture.pitchDeg).toBeCloseTo(10, 5);
    expect(report.posture.yawDeg).toBeCloseTo(-5, 5);
    expect(report.posture.eyeSpan).toBe(0.2);
  });

  it('breaks the error down by corners, edges, the middle and each half, and names the worst dot', () => {
    const CHECK_4X4 = grid([0.12, 0.38, 0.62, 0.88]);
    // Only the bottom-left corner dot is off: its eye reads 0.04 further right (0.05 of the width, 50 px).
    const off = { x: 0.12, y: 0.88 };
    const checked = CHECK_4X4.flatMap((target) => samples([target], target.x === off.x && target.y === off.y ? { x: 0.04, y: 0 } : { x: 0, y: 0 }));
    const report = measureAccuracy(model, checked, SCREEN);
    expect(report.regions.corners).toBeCloseTo(50 / 4, 0); // one corner of four is off
    expect(report.regions.edges).toBeLessThan(1);
    expect(report.regions.middle).toBeLessThan(1);
    expect(report.regions.top).toBeLessThan(1);
    expect(report.regions.bottom).toBeCloseTo(50 / 8, 0); // one dot of the eight in the bottom half
    expect(report.worst!.target).toEqual(off);
    expect(report.worst!.px).toBeCloseTo(50, 0);
  });

  it('reports the error in degrees of visual angle, the standard eye tracker measure', () => {
    // At 60 cm, 40 CSS pixels (about 1.06 cm) is about one degree.
    expect(visualAngle(40)).toBeCloseTo(1.01, 2);
    expect(visualAngle(80)).toBeCloseTo(2.02, 2);
    const report = measureAccuracy(model, samples(CHECK, { x: 0.04, y: 0 }), SCREEN);
    expect(report.meanDeg).toBeCloseTo(visualAngle(report.meanPx), 5);
  });
});
