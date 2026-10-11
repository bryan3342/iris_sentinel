import type { Point2 } from '@iris/protocol';

/**
 * Where the eyes rested longest in the last few seconds: the gaze point with the most others near
 * it, averaged with them. "Summarize this" arrives a second or two after the person looked (they
 * speak, then the agent decides), and by then the eyes may have moved on, so the latest point is not
 * the one they meant. Null when the eyes never settled long enough.
 */
export interface RestingPointOptions {
  /** How far back to look, in milliseconds. */
  windowMs?: number;
  /** How close, in pixels, points must be to count as one resting place. */
  radius?: number;
  /** Fewest points that make a resting place (about half a second of camera frames). */
  minPoints?: number;
}

export class RestingPoint {
  private readonly o: Required<RestingPointOptions>;
  private points: { at: Point2; t: number }[] = [];

  constructor(options: RestingPointOptions = {}) {
    this.o = { windowMs: 5_000, radius: 80, minPoints: 15, ...options };
  }

  /** Adds one gaze point at time `t` (ms); null (eyes closed or off the page) adds nothing. */
  push(at: Point2 | null, t: number): void {
    if (at) this.points.push({ at, t });
    while (this.points.length && t - this.points[0]!.t > this.o.windowMs) this.points.shift();
  }

  clear(): void {
    this.points = [];
  }

  point(now: number): Point2 | null {
    const recent = this.points.filter((p) => now - p.t <= this.o.windowMs).map((p) => p.at);
    let best: Point2[] = [];
    for (const p of recent) {
      const near = recent.filter((q) => Math.hypot(q.x - p.x, q.y - p.y) <= this.o.radius);
      if (near.length > best.length) best = near;
    }
    if (best.length < this.o.minPoints) return null;
    return { x: best.reduce((s, q) => s + q.x, 0) / best.length, y: best.reduce((s, q) => s + q.y, 0) / best.length };
  }
}
