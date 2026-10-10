import type { HeadPose, Point2 } from '@iris/protocol';
import { applyCalibration, type CalibrationModel, type CalibrationSample, type Viewport } from './calibration';

/**
 * How far the calibrated gaze lands from known check dots, measured through the
 * real calibration rather than assumed. Taken at several postures (lid angles,
 * seats), it shows how much posture costs, and is the yardstick every change to
 * gaze accuracy has to beat. Check dots differ from calibration dots, so the
 * check is not graded on the points the fit was made from.
 */
export interface AccuracyReport {
  /** Check dots measured. */
  dots: number;
  /** Mean and worst distance between a dot and where gaze landed, in the viewport's pixels. */
  meanPx: number;
  worstPx: number;
  /** Mean error left-right and up-down, in pixels. */
  meanXPx: number;
  meanYPx: number;
  /** Mean error as a fraction of the viewport width. */
  share: number;
  /** The head during the check: turn and tilt in degrees, and eye span (a distance cue; larger is closer). */
  posture: { yawDeg: number; pitchDeg: number; eyeSpan: number };
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const degrees = (radians: number) => (radians * 180) / Math.PI;

/** Scores `model` on samples taken while the user looked at check dots (targets are viewport fractions). */
export function measureAccuracy(model: CalibrationModel, samples: CalibrationSample[], viewport: Viewport): AccuracyReport {
  const byDot = new Map<string, { target: Point2; points: Point2[] }>();
  for (const s of samples) {
    const key = `${s.target.x},${s.target.y}`;
    const entry = byDot.get(key) ?? { target: s.target, points: [] };
    entry.points.push(applyCalibration(model, s.eye, s.head, viewport));
    byDot.set(key, entry);
  }
  // Each dot is scored at its middle reading, so a stray glance or blink does not count.
  const errors = [...byDot.values()].map(({ target, points }) => ({
    x: Math.abs(median(points.map((p) => p.x)) - target.x) * viewport.width,
    y: Math.abs(median(points.map((p) => p.y)) - target.y) * viewport.height,
  }));
  const mean = (values: number[]) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0);
  const distances = errors.map((e) => Math.hypot(e.x, e.y));
  const head = (pick: (h: HeadPose) => number) => median(samples.map((s) => pick(s.head)));
  return {
    dots: errors.length,
    meanPx: mean(distances),
    worstPx: Math.max(0, ...distances),
    meanXPx: mean(errors.map((e) => e.x)),
    meanYPx: mean(errors.map((e) => e.y)),
    share: mean(distances) / viewport.width,
    posture: { yawDeg: degrees(head((h) => h.yaw)), pitchDeg: degrees(head((h) => h.pitch)), eyeSpan: head((h) => h.eyeSpan) },
  };
}
