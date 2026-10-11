import { describe, expect, it } from 'vitest';
import { StruggleDetector } from '@iris/core';
import type { VitalsSample } from '@iris/protocol';

const SEC = 1_000;
const MIN = 60 * SEC;
const sample = (t: number, pulse: number | null, breathing: number | null, stable = true): VitalsSample => ({
  t,
  pulse: pulse === null ? null : { value: pulse, confidence: 0.9, stable },
  breathing: breathing === null ? null : { value: breathing, confidence: 0.9, stable },
  hrv: null,
});
/** Feeds one sample a second from `from` for `ms`; returns the times the detector said to offer help. */
function run(detector: StruggleDetector, from: number, ms: number, pulse: number | null, breathing: number | null, talking = false): number[] {
  const fired: number[] = [];
  for (let t = from; t < from + ms; t += SEC) if (detector.update(sample(t, pulse, breathing), talking)) fired.push(t);
  return fired;
}
/** A detector that has spent its first minute learning a resting heart rate of 70 and breathing of 14. */
function rested(): StruggleDetector {
  const detector = new StruggleDetector();
  expect(run(detector, 0, MIN, 70, 14)).toEqual([]); // learning: never says anything
  return detector;
}

describe('StruggleDetector', () => {
  it('learns the resting level from the first minute, then stays quiet around it', () => {
    expect(run(rested(), MIN, 5 * MIN, 72, 15)).toEqual([]);
  });

  it('offers help once heart rate holds 20% above the resting level for 20 seconds', () => {
    expect(run(rested(), MIN, 30 * SEC, 85, 14)).toEqual([MIN + 20 * SEC]);
  });

  it('offers help once breathing holds 30% above its resting level for 20 seconds', () => {
    expect(run(rested(), MIN, 30 * SEC, 70, 19)).toEqual([MIN + 20 * SEC]);
  });

  it('ignores a brief spike, a rise below the bar, and readings Presage does not trust yet', () => {
    const detector = rested();
    expect(run(detector, MIN, 15 * SEC, 90, 14)).toEqual([]);
    expect(run(detector, MIN + 15 * SEC, 30 * SEC, 70, 14)).toEqual([]);
    expect(run(detector, 2 * MIN, MIN, 82, 17)).toEqual([]); // 17% and 21% up
    for (let t = 3 * MIN; t < 4 * MIN; t += SEC) expect(detector.update(sample(t, 120, 30, false), false)).toBe(false);
  });

  it('starts over when readings pause, as when the face leaves the camera', () => {
    const detector = rested();
    expect(run(detector, MIN, 10 * SEC, 100, 14)).toEqual([]);
    expect(run(detector, MIN + 10 * SEC, 10 * SEC, null, 14)).toEqual([]);
    expect(run(detector, MIN + 20 * SEC, 15 * SEC, 100, 14)).toEqual([]);
  });

  it('stays quiet while the user talks and for 30 seconds after, since talking raises both', () => {
    const detector = rested();
    expect(run(detector, MIN, MIN, 100, 14, true)).toEqual([]);
    expect(run(detector, 2 * MIN, MIN, 100, 14)).toEqual([2 * MIN + 49 * SEC]); // counted from 30 s after the last talk
  });

  it('offers help at most once every ten minutes', () => {
    const detector = rested();
    expect(run(detector, MIN, 10 * MIN, 100, 14)).toEqual([MIN + 20 * SEC]);
    expect(run(detector, 11 * MIN, 2 * MIN, 100, 14)).toEqual([11 * MIN + 20 * SEC]);
  });

  it('learns again after a reset, for a new measuring session', () => {
    const detector = rested();
    detector.reset();
    expect(run(detector, 2 * MIN, MIN, 100, 20)).toEqual([]);
    expect(run(detector, 3 * MIN, MIN, 100, 20)).toEqual([]);
  });
});
