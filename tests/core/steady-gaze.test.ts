import { describe, expect, it } from 'vitest';
import { readLight, SteadyGaze } from '@iris/core';
import type { GazeSample } from '@iris/protocol';

const FRAME = 33;
let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const noise = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
const sample = (t: number, x: number, yaw = 0, blink = 0): GazeSample => ({
  t, eye: { x, y: 0, lid: 0.3 }, head: { yaw, pitch: 0, eyes: { x: 0.5, y: 0.5 }, eyeSpan: 0.2 }, blink: { left: blink, right: blink },
});
const spread = (values: number[]) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
};
/** Feeds `frames` noisy samples around `x` (and head turn noise); returns the steadied eye x and yaw after the first 20. */
function still(steady: SteadyGaze, frames = 60, trust = 1) {
  const xs: number[] = [], yaws: number[] = [];
  for (let i = 0; i < frames; i++) {
    const out = steady.filter(sample(i * FRAME, noise() * 0.015, noise() * 0.01), trust);
    if (i >= 20) { xs.push(out.eye!.x); yaws.push(out.head.yaw); }
  }
  return { xs, yaws };
}

describe('SteadyGaze', () => {
  it('cuts the wobble of eye and head readings held still to under 40%', () => {
    const { xs, yaws } = still(new SteadyGaze());
    expect(spread(xs)).toBeLessThan(0.015 * 0.4);
    expect(spread(yaws)).toBeLessThan(0.01 * 0.4);
  });

  it('follows a deliberate look elsewhere within 200 ms', () => {
    const steady = new SteadyGaze();
    for (let i = 0; i < 30; i++) steady.filter(sample(i * FRAME, 0));
    let t = 30 * FRAME, x = 0;
    while (x < 0.18) x = steady.filter(sample((t += FRAME), 0.2)).eye!.x;
    expect(t - 30 * FRAME).toBeLessThanOrEqual(200);
  });

  it('drops a single-frame spike, such as a flicker of light', () => {
    const steady = new SteadyGaze();
    for (let i = 0; i < 30; i++) steady.filter(sample(i * FRAME, 0));
    const spike = steady.filter(sample(30 * FRAME, 0.5));
    const after = steady.filter(sample(31 * FRAME, 0));
    expect(Math.abs(spike.eye!.x)).toBeLessThan(0.01);
    expect(Math.abs(after.eye!.x)).toBeLessThan(0.01);
  });

  it('smooths harder when the light makes readings less trustworthy', () => {
    seed = 11;
    const good = spread(still(new SteadyGaze(), 60, 1).xs);
    seed = 11;
    const poor = spread(still(new SteadyGaze(), 60, 0).xs);
    expect(poor).toBeLessThan(good);
  });

  it('passes blink closures through untouched, and a sample with no eyes stays without them', () => {
    const steady = new SteadyGaze();
    steady.filter(sample(0, 0));
    expect(steady.filter(sample(FRAME, 0, 0, 0.9)).blink).toEqual({ left: 0.9, right: 0.9 });
    expect(steady.filter({ ...sample(2 * FRAME, 0), eye: null }).eye).toBeNull();
  });

  it('starts afresh after the face was lost for a while', () => {
    const steady = new SteadyGaze();
    for (let i = 0; i < 30; i++) steady.filter(sample(i * FRAME, 0));
    expect(steady.filter(sample(30 * FRAME + 1000, 0.2)).eye!.x).toBeCloseTo(0.2, 5);
  });
});

describe('readLight', () => {
  it('trusts an evenly lit face and suggests nothing', () => {
    expect(readLight({ face: 130, contrast: 40, scene: 120 })).toEqual({ trust: 1, advice: null });
  });

  it('tells a dim face, a face against bright light behind it, and a washed-out face apart', () => {
    expect(readLight({ face: 40, contrast: 20, scene: 45 }).advice).toBe('dim');
    expect(readLight({ face: 70, contrast: 30, scene: 180 }).advice).toBe('backlit');
    expect(readLight({ face: 240, contrast: 20, scene: 200 }).advice).toBe('bright');
  });

  it('trusts the readings less as the face gets darker or flatter', () => {
    expect(readLight({ face: 40, contrast: 40, scene: 40 }).trust).toBeLessThan(0.5);
    expect(readLight({ face: 130, contrast: 10, scene: 130 }).trust).toBeLessThan(0.5);
  });
});
