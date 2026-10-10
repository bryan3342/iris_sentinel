import type { FaceSample, Point2 } from '@iris/protocol';

/**
 * Maps eye-in-head position plus head rotation to a point on the screen,
 * fitted from calibration samples gathered while the user looks at known dots.
 * Ridge-regularized least squares keeps the fit stable with few dots.
 */

export interface CalibrationSample {
  eye: Point2;
  head: FaceSample['head'];
  /** Where the dot was, as a fraction of the viewport (0..1). */
  target: Point2;
}

export interface CalibrationModel {
  x: number[];
  y: number[];
}

const RIDGE = 1e-6;
const MIN_TARGETS = 3;
const OUTLIER_KEEP = 0.8; // keep the 80% of samples per dot closest to its median

function features(eye: Point2, head: FaceSample['head']): number[] {
  return [1, eye.x, eye.y, head.yaw, head.pitch];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Drops glances away and blinks: per dot, keeps samples nearest the median eye position. */
function rejectOutliers(samples: CalibrationSample[]): CalibrationSample[] {
  const byTarget = new Map<string, CalibrationSample[]>();
  for (const s of samples) {
    const key = `${s.target.x},${s.target.y}`;
    byTarget.set(key, [...(byTarget.get(key) ?? []), s]);
  }
  if (byTarget.size < MIN_TARGETS) {
    throw new Error(`Calibration needs at least ${MIN_TARGETS} distinct dots.`);
  }
  return [...byTarget.values()].flatMap((group) => {
    const mx = median(group.map((s) => s.eye.x));
    const my = median(group.map((s) => s.eye.y));
    const distance = (s: CalibrationSample) => Math.hypot(s.eye.x - mx, s.eye.y - my);
    const keep = Math.max(1, Math.round(group.length * OUTLIER_KEEP));
    return [...group].sort((a, b) => distance(a) - distance(b)).slice(0, keep);
  });
}

/** Solves A w = b by Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const p = m[col]![col]!;
    if (Math.abs(p) < 1e-12) throw new Error('Calibration data is degenerate.');
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / p;
      for (let c = col; c <= n; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/**
 * Fits weights for raw feature rows (bias first). Features are centered first
 * so the ridge term only damps directions the data barely covers (for example
 * head rotation when the user held still) instead of shrinking the whole fit.
 */
function ridgeFit(rows: number[][], targets: number[]): number[] {
  const n = rows[0]!.length;
  const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const means = Array.from({ length: n }, (_, i) => (i === 0 ? 0 : mean(rows.map((r) => r[i]!))));
  const targetMean = mean(targets);
  const centered = rows.map((r) => r.slice(1).map((v, i) => v - means[i + 1]!));
  const ata = Array.from({ length: n - 1 }, (_, i) =>
    Array.from({ length: n - 1 }, (_, j) => centered.reduce((sum, r) => sum + r[i]! * r[j]!, 0)),
  );
  for (let i = 0; i < n - 1; i++) ata[i]![i]! += RIDGE * rows.length;
  const atb = Array.from({ length: n - 1 }, (_, i) =>
    centered.reduce((sum, r, k) => sum + r[i]! * (targets[k]! - targetMean), 0),
  );
  const weights = solve(ata, atb);
  const bias = targetMean - weights.reduce((sum, w, i) => sum + w * means[i + 1]!, 0);
  return [bias, ...weights];
}

export function fitCalibration(samples: CalibrationSample[]): CalibrationModel {
  const kept = rejectOutliers(samples);
  const rows = kept.map((s) => features(s.eye, s.head));
  return {
    x: ridgeFit(rows, kept.map((s) => s.target.x)),
    y: ridgeFit(rows, kept.map((s) => s.target.y)),
  };
}

/** Screen point (fraction of the viewport, clamped to 0..1) for one face sample. */
export function applyCalibration(model: CalibrationModel, eye: Point2, head: FaceSample['head']): Point2 {
  const f = features(eye, head);
  const dot = (w: number[]) => w.reduce((sum, wi, i) => sum + wi * f[i]!, 0);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return { x: clamp(dot(model.x)), y: clamp(dot(model.y)) };
}
