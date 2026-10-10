import { describe, expect, it } from 'vitest';
import { OneEuroFilter, PointFilter } from '@iris/core';

const FRAME_MS = 1000 / 30;

function variance(values: number[]): number {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}

describe('OneEuroFilter', () => {
  it('passes the first sample through unchanged', () => {
    expect(new OneEuroFilter().filter(0.42, 0)).toBe(0.42);
  });

  it('holds a constant signal steady', () => {
    const filter = new OneEuroFilter();
    for (let i = 0; i < 30; i++) {
      expect(filter.filter(0.5, i * FRAME_MS)).toBeCloseTo(0.5, 10);
    }
  });

  it('removes most jitter from a still gaze', () => {
    const filter = new OneEuroFilter({ minCutoff: 1 });
    const input: number[] = [];
    const output: number[] = [];
    for (let i = 0; i < 120; i++) {
      const value = 0.5 + (i % 2 === 0 ? 0.05 : -0.05);
      input.push(value);
      output.push(filter.filter(value, i * FRAME_MS));
    }
    expect(variance(output.slice(30))).toBeLessThan(variance(input.slice(30)) * 0.1);
  });

  it('follows a jump faster when beta is higher', () => {
    const slow = new OneEuroFilter({ beta: 0 });
    const fast = new OneEuroFilter({ beta: 5 });
    slow.filter(0, 0);
    fast.filter(0, 0);
    let slowValue = 0;
    let fastValue = 0;
    for (let i = 1; i <= 5; i++) {
      slowValue = slow.filter(1, i * FRAME_MS);
      fastValue = fast.filter(1, i * FRAME_MS);
    }
    expect(fastValue).toBeGreaterThan(slowValue);
  });

  it('ignores samples that do not move time forward', () => {
    const filter = new OneEuroFilter();
    filter.filter(0.2, 100);
    expect(filter.filter(0.9, 100)).toBe(0.2);
    expect(filter.filter(0.9, 50)).toBe(0.2);
  });

  it('starts fresh after reset', () => {
    const filter = new OneEuroFilter();
    filter.filter(0.1, 0);
    filter.filter(0.1, FRAME_MS);
    filter.reset();
    expect(filter.filter(0.8, 2 * FRAME_MS)).toBe(0.8);
  });
});

describe('PointFilter', () => {
  it('smooths each axis independently', () => {
    const filter = new PointFilter();
    filter.filter({ x: 0, y: 1 }, 0);
    const next = filter.filter({ x: 1, y: 1 }, FRAME_MS);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(1);
    expect(next.y).toBe(1);
  });
});
