import type { Point2 } from '@iris/protocol';

/**
 * Dispersion-based fixation smoothing (I-DT style). While new points stay
 * within `radius` of the current fixation, the output is the fixation's
 * running average, which removes webcam jitter. A point outside the radius is
 * a candidate jump; once `confirm` points in a row land outside, a new
 * fixation starts there. Units are whatever the caller passes (e.g. pixels).
 */
export interface FixationOptions {
  /** Max distance from the fixation center that still counts as the same fixation. */
  radius: number;
  /** Consecutive outside points needed to accept a jump. */
  confirm?: number;
  /** Most recent points averaged within one fixation. */
  window?: number;
}

const centroid = (points: Point2[]): Point2 => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
});

export class FixationSmoother {
  private readonly radius: number;
  private readonly confirm: number;
  private readonly window: number;
  private fixation: Point2[] = [];
  private pending: Point2[] = [];

  constructor({ radius, confirm = 3, window = 20 }: FixationOptions) {
    this.radius = radius;
    this.confirm = confirm;
    this.window = window;
  }

  push(point: Point2): Point2 {
    if (this.fixation.length === 0) {
      this.fixation = [point];
      return point;
    }
    const center = centroid(this.fixation);
    if (Math.hypot(point.x - center.x, point.y - center.y) <= this.radius) {
      this.fixation = [...this.fixation, point].slice(-this.window);
      this.pending = [];
      return centroid(this.fixation);
    }
    this.pending.push(point);
    if (this.pending.length < this.confirm) return center; // hold until the jump is confirmed
    this.fixation = this.pending;
    this.pending = [];
    return centroid(this.fixation);
  }

  reset(): void {
    this.fixation = [];
    this.pending = [];
  }
}
