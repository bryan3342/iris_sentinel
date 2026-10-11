import type { EyeReading, HeadPose, Point2 } from '@iris/protocol';

/**
 * Maps eye-in-head position to a point on the screen, fitted from calibration
 * samples gathered while the user looks at known dots. Ridge-regularized least
 * squares keeps the fit stable with few dots. Head movement after calibration
 * is corrected geometrically rather than learned, because the user holds still
 * while the dots are shown and a fit cannot learn from movement it never saw.
 */

export interface CalibrationSample {
  eye: EyeReading;
  head: HeadPose;
  /** Where the dot was, as a fraction of the viewport (0..1). */
  target: Point2;
  /** How much this sample counts in the fit; 1 when absent. */
  weight?: number;
}

export interface CalibrationModel {
  x: number[];
  y: number[];
  /** Adds curved eye terms; used when there are enough dots to support them. */
  quadratic: boolean;
  /** Median head state while calibrating; movement away from it shifts the fitted point. */
  head: HeadPose;
  /**
   * Median eyelid opening while calibrating, when every sample carried one; the opening is then a fit
   * input, which mostly helps tell up from down. Null for calibrations made without it.
   */
  lid: number | null;
}

export interface Viewport {
  width: number;
  height: number;
}

const RIDGE = 1e-6;
const MIN_TARGETS = 3;
const QUADRATIC_MIN_TARGETS = 9;
const QUADRATIC_MIN_SAMPLES = 18; // three samples per curved weight, so a few scattered confirms cannot bend the map
const OUTLIER_KEEP = 0.8; // keep the 80% of samples per dot closest to its median

// The outer eye corners are the ruler that turns image units into centimeters.
const EYE_SPAN_CM = 9; // adult outer eye-corner distance
export const CALIBRATION_DISTANCE_CM = 60; // assumed seat distance while calibrating, scaled by eye span since
export const CSS_PX_PER_CM = 96 / 2.54; // a CSS pixel is defined as 1/96 inch
const MAX_SHIFT = 0.5; // viewport fraction, so a landmark glitch cannot throw the point off-screen

/** Fit inputs for one eye reading. A reading without a lid opening counts as the calibration's own median. */
function features(eye: EyeReading, quadratic: boolean, lid: number | null): number[] {
  const linear = [1, eye.x, eye.y, ...(lid === null ? [] : [eye.lid ?? lid])];
  return quadratic ? [...linear, eye.x * eye.x, eye.y * eye.y, eye.x * eye.y] : linear;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function medianHead(samples: CalibrationSample[]): HeadPose {
  const of = (pick: (h: HeadPose) => number) => median(samples.map((s) => pick(s.head)));
  return {
    yaw: of((h) => h.yaw),
    pitch: of((h) => h.pitch),
    eyes: { x: of((h) => h.eyes.x), y: of((h) => h.eyes.y) },
    eyeSpan: of((h) => h.eyeSpan),
  };
}

/** Drops glances away and blinks: per dot, keeps samples nearest the median eye position. */
function rejectOutliers(samples: CalibrationSample[]): { kept: CalibrationSample[]; targets: number } {
  const byTarget = new Map<string, CalibrationSample[]>();
  for (const s of samples) {
    const key = `${s.target.x},${s.target.y}`;
    byTarget.set(key, [...(byTarget.get(key) ?? []), s]);
  }
  if (byTarget.size < MIN_TARGETS) {
    throw new Error(`Calibration needs at least ${MIN_TARGETS} distinct dots.`);
  }
  const kept = [...byTarget.values()].flatMap((group) => {
    const mx = median(group.map((s) => s.eye.x));
    const my = median(group.map((s) => s.eye.y));
    const distance = (s: CalibrationSample) => Math.hypot(s.eye.x - mx, s.eye.y - my);
    const keep = Math.max(1, Math.round(group.length * OUTLIER_KEEP));
    return [...group].sort((a, b) => distance(a) - distance(b)).slice(0, keep);
  });
  return { kept, targets: byTarget.size };
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
 * Fits weights for raw feature rows (bias first), each row counting by its
 * weight. Features are centered first so the ridge term only damps directions
 * the data barely covers instead of shrinking the whole fit.
 */
function ridgeFit(rows: number[][], targets: number[], weights: number[]): number[] {
  const n = rows[0]!.length;
  const total = weights.reduce((sum, w) => sum + w, 0);
  const mean = (values: number[]) => values.reduce((sum, v, k) => sum + weights[k]! * v, 0) / total;
  const means = Array.from({ length: n }, (_, i) => (i === 0 ? 0 : mean(rows.map((r) => r[i]!))));
  const targetMean = mean(targets);
  const centered = rows.map((r) => r.slice(1).map((v, i) => v - means[i + 1]!));
  const ata = Array.from({ length: n - 1 }, (_, i) =>
    Array.from({ length: n - 1 }, (_, j) => centered.reduce((sum, r, k) => sum + weights[k]! * r[i]! * r[j]!, 0)),
  );
  for (let i = 0; i < n - 1; i++) ata[i]![i]! += RIDGE * total;
  const atb = Array.from({ length: n - 1 }, (_, i) =>
    centered.reduce((sum, r, k) => sum + weights[k]! * r[i]! * (targets[k]! - targetMean), 0),
  );
  const coefficients = solve(ata, atb);
  const bias = targetMean - coefficients.reduce((sum, c, i) => sum + c * means[i + 1]!, 0);
  return [bias, ...coefficients];
}

/**
 * Samples may come from any head position (dots are taken still, confirmed
 * targets during use are not). Each target is first moved to where the eyes
 * would have seen it from the median head position, so the fit maps eye
 * position alone and `applyCalibration` adds the head shift back.
 */
export function fitCalibration(samples: CalibrationSample[], viewport: Viewport): CalibrationModel {
  const { kept, targets } = rejectOutliers(samples);
  const quadratic = targets >= QUADRATIC_MIN_TARGETS && kept.length >= QUADRATIC_MIN_SAMPLES;
  const head = medianHead(kept);
  // The lid opening joins the fit only when every sample has one; older saved calibrations have none.
  const lids = kept.map((s) => s.eye.lid);
  const lid = lids.every((v): v is number => typeof v === 'number') ? median(lids as number[]) : null;
  const rows = kept.map((s) => features(s.eye, quadratic, lid));
  const weights = kept.map((s) => s.weight ?? 1);
  const seen = kept.map((s) => {
    const shift = headShift(head, s.head, viewport);
    return { x: s.target.x - shift.x, y: s.target.y - shift.y };
  });
  return {
    quadratic,
    head,
    lid,
    x: ridgeFit(rows, seen.map((t) => t.x), weights),
    y: ridgeFit(rows, seen.map((t) => t.y), weights),
  };
}

/**
 * Screen shift (viewport fraction) that undoes head movement since calibration.
 * Moving the head sideways by d cm while looking at one point turns the eyes by
 * d over the viewing distance, which the fit reads as a point d cm away; turning
 * the head by an angle reads as a point (distance times its tangent) away. Both
 * are added back here. Image x grows toward the user's left while screen x grows
 * toward their right; y grows downward in both. Turning left swings the eyes right
 * in the head, so the fit reads too far right; tilting down makes them look up,
 * so it reads too high.
 */
function headShift(base: HeadPose, head: HeadPose, viewport: Viewport): Point2 {
  if (base.eyeSpan <= 0 || head.eyeSpan <= 0) return { x: 0, y: 0 };
  const cmPerUnit = EYE_SPAN_CM / head.eyeSpan;
  const distance = (CALIBRATION_DISTANCE_CM * base.eyeSpan) / head.eyeSpan;
  const dxCm = -(head.eyes.x - base.eyes.x) * cmPerUnit - distance * Math.tan(head.yaw - base.yaw);
  const dyCm = (head.eyes.y - base.eyes.y) * cmPerUnit + distance * Math.tan(head.pitch - base.pitch);
  const clip = (v: number) => Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, v));
  return { x: clip((dxCm * CSS_PX_PER_CM) / viewport.width), y: clip((dyCm * CSS_PX_PER_CM) / viewport.height) };
}

/** Screen point (fraction of the viewport, clamped to 0..1) for one gaze sample. */
export function applyCalibration(model: CalibrationModel, eye: EyeReading, head: HeadPose, viewport: Viewport): Point2 {
  const f = features(eye, model.quadratic, model.lid);
  const dot = (w: number[]) => w.reduce((sum, wi, i) => sum + wi * f[i]!, 0);
  const shift = headShift(model.head, head, viewport);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return { x: clamp(dot(model.x) + shift.x), y: clamp(dot(model.y) + shift.y) };
}
