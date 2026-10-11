import type { HeadPose, Point2 } from '@iris/protocol';
import { applyCalibration, CALIBRATION_DISTANCE_CM, CSS_PX_PER_CM, type CalibrationModel, type CalibrationSample, type Viewport } from './calibration';

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
  /**
   * How much gaze wanders while the eyes hold still on a dot, in pixels: each dot's middle distance
   * of its readings from their own middle point, averaged over the dots. Lower is steadier.
   */
  shakePx: number;
  /** Mean error left-right and up-down, in pixels. */
  meanXPx: number;
  meanYPx: number;
  /** Mean error as a fraction of the viewport width. */
  share: number;
  /**
   * Mean error in degrees of visual angle, the standard measure for eye trackers (webcam trackers
   * typically reach 1 to 2 degrees, research systems 0.3 to 0.5). Approximate: it assumes the user
   * sits about 60 cm away and that a CSS pixel is 1/96 inch, as the calibration does.
   */
  meanDeg: number;
  /** The head during the check: turn and tilt in degrees, and eye span (a distance cue; larger is closer). */
  posture: { yawDeg: number; pitchDeg: number; eyeSpan: number };
  /**
   * Mean error by where the dots sit, in pixels, or null where the check had no dots. On a grid,
   * corners are the outermost dots both ways, edges the rest of the outer ring, and middle the dots
   * between them; top and bottom split the dots by height.
   */
  regions: { corners: number | null; edges: number | null; middle: number | null; top: number | null; bottom: number | null };
  /** The dot gaze missed by the most, and by how much. */
  worst: { target: Point2; px: number } | null;
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
  const errors = [...byDot.values()].map(({ target, points }) => {
    const mid = { x: median(points.map((p) => p.x)), y: median(points.map((p) => p.y)) };
    const x = Math.abs(mid.x - target.x) * viewport.width;
    const y = Math.abs(mid.y - target.y) * viewport.height;
    const shake = median(points.map((p) => Math.hypot((p.x - mid.x) * viewport.width, (p.y - mid.y) * viewport.height)));
    return { target, x, y, px: Math.hypot(x, y), shake };
  });
  const mean = (values: number[]) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0);
  const distances = errors.map((e) => e.px);
  const worst = errors.reduce<(typeof errors)[number] | null>((w, e) => (!w || e.px > w.px ? e : w), null);
  const head = (pick: (h: HeadPose) => number) => median(samples.map((s) => pick(s.head)));
  return {
    dots: errors.length,
    meanPx: mean(distances),
    worstPx: Math.max(0, ...distances),
    shakePx: mean(errors.map((e) => e.shake)),
    meanXPx: mean(errors.map((e) => e.x)),
    meanYPx: mean(errors.map((e) => e.y)),
    share: mean(distances) / viewport.width,
    meanDeg: visualAngle(mean(distances)),
    posture: { yawDeg: degrees(head((h) => h.yaw)), pitchDeg: degrees(head((h) => h.pitch)), eyeSpan: head((h) => h.eyeSpan) },
    regions: regions(errors),
    worst: worst && { target: worst.target, px: worst.px },
  };
}

/** Degrees of visual angle for an on-screen distance in CSS pixels, seen from the assumed seat distance. */
export function visualAngle(px: number, distanceCm = CALIBRATION_DISTANCE_CM): number {
  return (Math.atan(px / CSS_PX_PER_CM / distanceCm) * 180) / Math.PI;
}

/** Mean error by region of the check grid. */
function regions(errors: { target: Point2; px: number }[]): AccuracyReport['regions'] {
  const xs = errors.map((e) => e.target.x), ys = errors.map((e) => e.target.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const outerX = (e: { target: Point2 }) => e.target.x === minX || e.target.x === maxX;
  const outerY = (e: { target: Point2 }) => e.target.y === minY || e.target.y === maxY;
  const midY = (minY + maxY) / 2;
  const meanOf = (picked: { px: number }[]) => (picked.length ? picked.reduce((sum, e) => sum + e.px, 0) / picked.length : null);
  return {
    corners: meanOf(errors.filter((e) => outerX(e) && outerY(e))),
    edges: meanOf(errors.filter((e) => outerX(e) !== outerY(e))),
    middle: meanOf(errors.filter((e) => !outerX(e) && !outerY(e))),
    top: meanOf(errors.filter((e) => e.target.y < midY)),
    bottom: meanOf(errors.filter((e) => e.target.y > midY)),
  };
}
