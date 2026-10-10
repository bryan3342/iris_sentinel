import { quantile } from './stats';

/**
 * A user's own resting level for one fatigue clue, and how far a current value
 * has moved from it toward tired ("strain", 0 to 1).
 *
 * Until enough usable values arrive, the baseline is a fallback: a typical
 * resting value. Then it is set once, from the rested end of those first
 * values, and frozen. Taking the rested end means a user who was already
 * tiring while it was collected still gets their normal, as long as about a
 * quarter of the values were rested. The baseline lives in memory for this
 * session only, because saving it would mean storing heart, breathing or blink
 * data.
 */

/** Which way a clue moves as the user tires: blink rate goes up, heart rate variability goes down. */
export type TiredDirection = 'up' | 'down';

export interface BaselineOptions {
  /** Value used until the personal baseline is set, or null for a clue with no sensible default. */
  fallback: number | null;
  tiredDirection: TiredDirection;
  /** Usable values needed before the personal baseline is set. */
  samples?: number;
  /**
   * How far into the rested end the baseline is taken: 0.25 means the 25th
   * percentile when up is tired, and the 75th when down is tired.
   */
  restedQuantile?: number;
}

export class Baseline {
  private readonly fallback: number | null;
  private readonly tiredDirection: TiredDirection;
  private readonly samples: number;
  private readonly restedQuantile: number;
  private collected: number[] = [];
  private personalValue: number | null = null;

  constructor({ fallback, tiredDirection, samples = 60, restedQuantile = 0.25 }: BaselineOptions) {
    this.fallback = fallback;
    this.tiredDirection = tiredDirection;
    this.samples = samples;
    this.restedQuantile = restedQuantile;
  }

  /** The personal baseline once set, otherwise the fallback. */
  get value(): number | null {
    return this.personalValue ?? this.fallback;
  }

  /** True once the baseline comes from this user rather than the fallback. */
  get personal(): boolean {
    return this.personalValue !== null;
  }

  /** Adds one usable value. Ignored once the personal baseline is set. */
  add(value: number): void {
    if (this.personalValue !== null || !Number.isFinite(value)) return;
    this.collected.push(value);
    if (this.collected.length < this.samples) return;
    const q = this.tiredDirection === 'up' ? this.restedQuantile : 1 - this.restedQuantile;
    this.personalValue = quantile(this.collected, q);
    this.collected = [];
  }

  /** Back to the fallback, for a new session. */
  reset(): void {
    this.collected = [];
    this.personalValue = null;
  }
}

export interface StrainOptions {
  tiredDirection: TiredDirection;
  /** Change toward tired, as a fraction of the baseline, that still counts as noise (0.25 means 25%). */
  ignoreBelow: number;
  /** Change toward tired, as a fraction of the baseline, that counts as fully strained. */
  fullAt: number;
}

/**
 * How far `current` has moved from `baseline` toward tired: 0 inside the
 * ignore zone or when it moved the rested way, 1 at or past `fullAt`, and
 * linear in between. The change is relative: 20 blinks a minute against a
 * baseline of 16 is a 25% rise. Null when either value is missing or not
 * finite, or the baseline is not positive.
 */
export function strain(current: number | null, baseline: number | null, { tiredDirection, ignoreBelow, fullAt }: StrainOptions): number | null {
  if (current === null || baseline === null || !Number.isFinite(current) || !Number.isFinite(baseline) || baseline <= 0) return null;
  const change = (current - baseline) / baseline;
  const towardTired = tiredDirection === 'up' ? change : -change;
  return Math.min(Math.max((towardTired - ignoreBelow) / (fullAt - ignoreBelow), 0), 1);
}
