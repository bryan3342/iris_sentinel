import { describe, expect, it } from 'vitest';
import { combineScore, FatigueLevelTracker } from '@iris/core';
import type { FatigueLevel } from '@iris/protocol';

describe('combineScore', () => {
  it('mixes the strains by weight into a score from 0 to 100', () => {
    expect(combineScore({ hrv: 1, blink: 0 }, { hrv: 0.75, blink: 0.25 })).toEqual({ score: 75, coverage: 1 });
  });

  it('re-weights over the clues that are available', () => {
    const { score, coverage } = combineScore({ hrv: 0.5, blink: null }, { hrv: 0.4, blink: 0.6 });
    expect(score).toBe(50);
    expect(coverage).toBeCloseTo(0.4);
  });

  it('gives no score when too little of the weight is available', () => {
    expect(combineScore({ timeToClick: 1 }, { timeToClick: 0.15, hrv: 0.3, blink: 0.25, breathing: 0.15, aim: 0.15 })).toEqual({
      score: null,
      coverage: 0.15,
    });
    expect(combineScore({}, { hrv: 1 })).toEqual({ score: null, coverage: 0 });
  });

  it('skips values that are not finite and keeps strains within 0 to 1', () => {
    expect(combineScore({ hrv: Number.NaN, blink: 2 }, { hrv: 0.5, blink: 0.5 }, { minCoverage: 0.5 })).toEqual({ score: 100, coverage: 0.5 });
  });
});

/** Feeds one score a second from `from` (inclusive) to `to` (exclusive); returns every level change as [t, level]. */
function feed(tracker: FatigueLevelTracker, score: (t: number) => number | null, from: number, to: number): [number, FatigueLevel][] {
  const changes: [number, FatigueLevel][] = [];
  for (let t = from; t < to; t += 1_000) {
    const before = tracker.level;
    const after = tracker.update(t, score(t));
    if (after !== before) changes.push([t, after]);
  }
  return changes;
}

describe('FatigueLevelTracker', () => {
  it('starts fresh and steps up after the score stays above a cutoff for 10 seconds', () => {
    const tracker = new FatigueLevelTracker();
    expect(tracker.level).toBe('fresh');
    expect(feed(tracker, () => 40, 0, 20_000)).toEqual([[10_000, 'tiring']]);
  });

  it('ignores a short spike', () => {
    const tracker = new FatigueLevelTracker();
    expect(feed(tracker, (t) => (t < 5_000 ? 90 : 20), 0, 60_000)).toEqual([]);
  });

  it('climbs one level at a time and needs 30 seconds above 75 for strained', () => {
    const tracker = new FatigueLevelTracker();
    expect(feed(tracker, () => 90, 0, 60_000)).toEqual([
      [10_000, 'tiring'],
      [20_000, 'fatigued'],
      [50_000, 'strained'],
    ]);
  });

  it('steps down one level at a time, only after 30 seconds clearly below', () => {
    const tracker = new FatigueLevelTracker();
    feed(tracker, () => 90, 0, 60_000); // strained; the last high score is at 59 s
    expect(feed(tracker, () => 10, 60_000, 200_000)).toEqual([
      [89_000, 'fatigued'], // 30 s after the score dropped
      [119_000, 'tiring'],
      [149_000, 'fresh'],
    ]);
  });

  it('holds the level while the score sits just under the cutoff', () => {
    const tracker = new FatigueLevelTracker();
    feed(tracker, () => 40, 0, 20_000); // tiring
    expect(feed(tracker, () => 30, 20_000, 200_000)).toEqual([]); // 30 is not clearly below 35
  });

  it('changes level at most twice in 10 minutes when a noisy score hovers at a cutoff', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    const tracker = new FatigueLevelTracker();
    const changes = feed(tracker, () => 35 + random() * 6, 0, 600_000);
    expect(changes.length).toBeLessThanOrEqual(2);
  });

  it('stops its timers while there is no score, without resetting them', () => {
    const tracker = new FatigueLevelTracker();
    const score = (t: number) => (t >= 6_000 && t < 66_000 ? null : 40);
    expect(feed(tracker, score, 0, 80_000)).toEqual([[70_000, 'tiring']]); // 5 s before the pause and 5 s after
  });

  it('goes back to fresh on reset', () => {
    const tracker = new FatigueLevelTracker();
    feed(tracker, () => 90, 0, 60_000);
    tracker.reset();
    expect(tracker.level).toBe('fresh');
  });
});
