import { describe, expect, it } from 'vitest';
import { fitCalibration, measureAccuracy, type CalibrationSample } from '@iris/core';
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
});
