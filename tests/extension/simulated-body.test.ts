import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlinkEvent, Quality, QualityStatus, VitalsSample } from '@iris/protocol';
import { DEMO_WARM_UP, SimulatedBodyProvider, TIRING_DEMO, type SimulatedBodyOptions } from '../../extension/src/providers/simulated/body';

interface Recording {
  blinks: BlinkEvent[];
  statuses: QualityStatus[];
  vitals: VitalsSample[];
}

/** Runs a simulated body for `ms` of fake time and records everything it sends. */
async function run(ms: number, options: SimulatedBodyOptions = {}): Promise<Recording> {
  const provider = new SimulatedBodyProvider(options);
  const recording: Recording = { blinks: [], statuses: [], vitals: [] };
  provider.onBlink((b) => recording.blinks.push(b));
  provider.onQuality((s) => recording.statuses.push(s));
  provider.onVitals((v) => recording.vitals.push(v));
  await provider.start();
  vi.advanceTimersByTime(ms);
  provider.stop();
  return recording;
}

const between = (from: number, to: number) => (item: { t: number }) => item.t >= from && item.t < to;
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const firstStable = (vitals: VitalsSample[], key: 'pulse' | 'breathing' | 'hrv') => vitals.find((v) => v[key]?.stable)?.t;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('TIRING_DEMO', () => {
  it('stays rested for a minute, then tires steadily until clearly tired at 135 s', () => {
    expect(TIRING_DEMO(30_000)).toBe(0);
    expect(TIRING_DEMO(60_000)).toBe(0);
    expect(TIRING_DEMO(97_500)).toBe(0.5);
    expect(TIRING_DEMO(135_000)).toBe(1);
    expect(TIRING_DEMO(300_000)).toBe(1);
  });
});

describe('SimulatedBodyProvider', () => {
  it('blinks about 15 times a minute when rested and about 27 when tired', async () => {
    const rested = await run(300_000);
    expect(rested.blinks.length).toBeGreaterThan(65); // about 75 in 5 minutes
    expect(rested.blinks.length).toBeLessThan(85);
    const tired = await run(300_000, { tiredness: () => 1 });
    expect(tired.blinks.length).toBeGreaterThan(120); // about 133 in 5 minutes
    expect(tired.blinks.length).toBeLessThan(145);
  });

  it('sends vitals once a second, each stable only after its Presage warm-up', async () => {
    const { vitals } = await run(80_000);
    expect(vitals).toHaveLength(80);
    expect(firstStable(vitals, 'pulse')).toBe(13_000);
    expect(firstStable(vitals, 'breathing')).toBe(32_000);
    expect(firstStable(vitals, 'hrv')).toBe(68_000);
    expect(vitals[0]!.hrv).toMatchObject({ stable: false, confidence: 0.3 });
    expect(vitals.at(-1)!.hrv).toMatchObject({ stable: true, confidence: 0.9 });
  });

  it('warms up within seconds with the demo warm-up', async () => {
    const { vitals } = await run(30_000, { warmUp: DEMO_WARM_UP });
    expect(firstStable(vitals, 'pulse')).toBe(5_000);
    expect(firstStable(vitals, 'hrv')).toBe(21_000);
  });

  it('moves from resting toward tired values as the demo scenario tires', async () => {
    const { vitals, blinks } = await run(200_000, { tiredness: TIRING_DEMO });
    const hrv = (from: number, to: number) => mean(vitals.filter(between(from, to)).map((v) => v.hrv!.value));
    expect(hrv(0, 60_000)).toBeCloseTo(45, 0);
    expect(hrv(140_000, 200_000)).toBeCloseTo(25, 0);
    expect(blinks.filter(between(140_000, 200_000)).length).toBeGreaterThan(22); // about 27 a minute
  });

  it('repeats exactly with the same seed', async () => {
    const first = await run(60_000, { seed: 3 });
    const again = await run(60_000, { seed: 3 });
    const other = await run(60_000, { seed: 4 });
    expect(again).toEqual(first);
    expect(other.blinks).not.toEqual(first.blinks);
  });

  it('reports quality only when it changes, and goes quiet while the face is lost', async () => {
    const quality = (t: number): Quality => (t >= 10_000 && t < 20_000 ? 'no-face' : 'ok');
    const { statuses, blinks, vitals } = await run(40_000, { quality });
    expect(statuses.map((s) => [s.t, s.quality])).toEqual([
      [100, 'ok'],
      [10_000, 'no-face'],
      [20_000, 'ok'],
    ]);
    expect(blinks.filter(between(10_000, 20_000))).toEqual([]);
    expect(vitals.filter(between(10_000, 20_000)).every((v) => !v.pulse && !v.breathing && !v.hrv)).toBe(true);
    expect(vitals.find((v) => v.t === 25_000)!.pulse!.stable).toBe(false); // warming up again since 20 s
    expect(vitals.find((v) => v.t === 32_000)!.pulse!.stable).toBe(true);
  });

  it('drops only breathing while the chest is out of view', async () => {
    const quality = (t: number): Quality => (t >= 20_000 ? 'chest-not-visible' : 'ok');
    const { vitals, blinks } = await run(30_000, { quality });
    const late = vitals.filter(between(20_000, 30_000));
    expect(late.every((v) => v.breathing === null)).toBe(true);
    expect(late.every((v) => v.pulse?.stable)).toBe(true);
    expect(blinks.some(between(20_000, 30_000))).toBe(true);
  });
});
