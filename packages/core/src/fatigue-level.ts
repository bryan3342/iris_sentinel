import { FATIGUE_LEVELS, type FatigueLevel } from '@iris/protocol';

/**
 * Turns per-clue strains into one fatigue score, and the score into a level
 * that does not flicker.
 *
 * The score (0 to 100) is the weighted mean of the strains that are available
 * right now, so a missing clue (still warming up, chest out of view) simply
 * drops out. When too little of the total weight is available, there is no
 * score at all rather than one resting on a single noisy clue.
 *
 * The level moves one step at a time. It goes up only after the score has
 * stayed at or above the next cutoff for a while, and down only after it has
 * stayed clearly below the current cutoff for longer, so help that makes
 * clicking easier does not switch itself straight back off. While there is no
 * score, the timers stop rather than reset.
 */

export interface ScoreOptions {
  /** Share of the total weight that must be available for a score, 0 to 1. */
  minCoverage?: number;
}

export interface Score {
  /** 0 (rested) to 100 (most tired), or null when too few clues are available. */
  score: number | null;
  /** Share of the total weight whose clues were available, 0 to 1. */
  coverage: number;
}

/** Weighted mean of the available strains (each 0 to 1), as a score from 0 to 100. */
export function combineScore<Clue extends string>(
  strains: Partial<Record<Clue, number | null>>,
  weights: Record<Clue, number>,
  { minCoverage = 0.3 }: ScoreOptions = {},
): Score {
  let total = 0;
  let available = 0;
  let weighted = 0;
  for (const clue of Object.keys(weights) as Clue[]) {
    const weight = weights[clue];
    total += weight;
    const value = strains[clue];
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    available += weight;
    weighted += weight * Math.min(Math.max(value, 0), 1);
  }
  const coverage = total > 0 ? available / total : 0;
  if (available === 0 || coverage < minCoverage) return { score: null, coverage };
  return { score: (100 * weighted) / available, coverage };
}

export interface FatigueLevelOptions {
  /** Scores where tiring, fatigued and strained begin. */
  cutoffs?: readonly [number, number, number];
  /** Time at or above the next cutoff before stepping up to tiring or fatigued, in milliseconds. */
  upAfterMs?: number;
  /** Time at or above the strained cutoff before stepping up to strained, in milliseconds. */
  strainedAfterMs?: number;
  /** Time clearly below the current cutoff before stepping down one level, in milliseconds. */
  downAfterMs?: number;
  /** How far below the current cutoff counts as clearly below. */
  downMargin?: number;
}

export class FatigueLevelTracker {
  private readonly cutoffs: readonly [number, number, number];
  private readonly upAfterMs: number;
  private readonly strainedAfterMs: number;
  private readonly downAfterMs: number;
  private readonly downMargin: number;
  /** Index into FATIGUE_LEVELS. */
  private index = 0;
  private upFor = 0;
  private downFor = 0;
  private lastT: number | null = null;

  constructor({ cutoffs = [35, 55, 75], upAfterMs = 10_000, strainedAfterMs = 30_000, downAfterMs = 30_000, downMargin = 8 }: FatigueLevelOptions = {}) {
    this.cutoffs = cutoffs;
    this.upAfterMs = upAfterMs;
    this.strainedAfterMs = strainedAfterMs;
    this.downAfterMs = downAfterMs;
    this.downMargin = downMargin;
  }

  get level(): FatigueLevel {
    return FATIGUE_LEVELS[this.index]!;
  }

  /** Feeds the score at time `t` (null while there is none) and returns the level after it. */
  update(t: number, score: number | null): FatigueLevel {
    const dt = this.lastT === null ? 0 : Math.max(t - this.lastT, 0);
    this.lastT = t;
    if (score === null) return this.level; // paused: timers hold still

    const next = this.cutoffs[this.index]; // cutoff into the next level up, if any
    const current = this.index > 0 ? this.cutoffs[this.index - 1]! : null; // cutoff into this level
    if (next !== undefined && score >= next) {
      this.downFor = 0;
      this.upFor += dt;
      const needed = this.index === this.cutoffs.length - 1 ? this.strainedAfterMs : this.upAfterMs;
      if (this.upFor >= needed) this.step(1);
    } else if (current !== null && score < current - this.downMargin) {
      this.upFor = 0;
      this.downFor += dt;
      if (this.downFor >= this.downAfterMs) this.step(-1);
    } else {
      this.upFor = 0;
      this.downFor = 0;
    }
    return this.level;
  }

  reset(): void {
    this.index = 0;
    this.upFor = 0;
    this.downFor = 0;
    this.lastT = null;
  }

  private step(by: 1 | -1): void {
    this.index += by;
    this.upFor = 0;
    this.downFor = 0;
  }
}
