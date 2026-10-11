import type { Point2 } from '@iris/protocol';

/**
 * One Euro filter (Casiez et al., CHI 2012): heavy smoothing while the signal
 * is still, light smoothing while it moves fast. Cuts webcam gaze jitter
 * without adding lag to deliberate eye movements.
 */
export interface OneEuroOptions {
  /** Cutoff frequency in Hz at rest. Lower means smoother and laggier. */
  minCutoff?: number;
  /** How quickly the cutoff rises with speed. Higher means less lag. */
  beta?: number;
  /** Cutoff in Hz for the speed estimate. */
  derivativeCutoff?: number;
}

function smoothingFactor(dtSeconds: number, cutoffHz: number): number {
  const r = 2 * Math.PI * cutoffHz * dtSeconds;
  return r / (r + 1);
}

export class OneEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly derivativeCutoff: number;
  private last: { value: number; t: number } | null = null;
  private speed = 0;

  constructor({ minCutoff = 1, beta = 0, derivativeCutoff = 1 }: OneEuroOptions = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
  }

  /** Filters one value; `tMs` must increase between calls. `cutoffScale` below 1 smooths a less trusted reading harder. */
  filter(value: number, tMs: number, cutoffScale = 1): number {
    if (this.last === null) {
      this.last = { value, t: tMs };
      return value;
    }
    const dt = (tMs - this.last.t) / 1000;
    if (dt <= 0) return this.last.value;

    const rawSpeed = (value - this.last.value) / dt;
    const aSpeed = smoothingFactor(dt, this.derivativeCutoff);
    this.speed = aSpeed * rawSpeed + (1 - aSpeed) * this.speed;

    const cutoff = this.minCutoff * cutoffScale + this.beta * Math.abs(this.speed);
    const a = smoothingFactor(dt, cutoff);
    const smoothed = a * value + (1 - a) * this.last.value;
    this.last = { value: smoothed, t: tMs };
    return smoothed;
  }

  reset(): void {
    this.last = null;
    this.speed = 0;
  }
}

/** One Euro filter applied to each axis of a 2D point. */
export class PointFilter {
  private readonly x: OneEuroFilter;
  private readonly y: OneEuroFilter;

  constructor(options: OneEuroOptions = {}) {
    this.x = new OneEuroFilter(options);
    this.y = new OneEuroFilter(options);
  }

  filter(point: Point2, tMs: number): Point2 {
    return { x: this.x.filter(point.x, tMs), y: this.y.filter(point.y, tMs) };
  }

  reset(): void {
    this.x.reset();
    this.y.reset();
  }
}
