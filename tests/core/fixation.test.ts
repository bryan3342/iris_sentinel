import { describe, expect, it } from 'vitest';
import { FixationSmoother } from '@iris/core';

describe('FixationSmoother', () => {
  it('averages jitter while the gaze rests on one spot', () => {
    const smoother = new FixationSmoother({ radius: 50 });
    let out = { x: 0, y: 0 };
    for (let i = 0; i < 20; i++) out = smoother.push({ x: 500 + (i % 2 ? 20 : -20), y: 300 });
    expect(out.x).toBeCloseTo(500, 0);
    expect(out.y).toBe(300);
  });

  it('holds position on a single stray sample', () => {
    const smoother = new FixationSmoother({ radius: 50 });
    smoother.push({ x: 500, y: 300 });
    expect(smoother.push({ x: 900, y: 300 })).toEqual({ x: 500, y: 300 });
    expect(smoother.push({ x: 505, y: 300 }).x).toBeCloseTo(502.5);
  });

  it('jumps to a new spot once the move is confirmed', () => {
    const smoother = new FixationSmoother({ radius: 50, confirm: 3 });
    smoother.push({ x: 500, y: 300 });
    smoother.push({ x: 900, y: 300 });
    smoother.push({ x: 905, y: 300 });
    expect(smoother.push({ x: 910, y: 300 })).toEqual({ x: 905, y: 300 });
  });

  it('ignores outside points that disagree with each other', () => {
    const smoother = new FixationSmoother({ radius: 50, confirm: 3 });
    smoother.push({ x: 500, y: 300 });
    smoother.push({ x: 900, y: 300 });
    smoother.push({ x: 100, y: 300 });
    expect(smoother.push({ x: 900, y: 600 })).toEqual({ x: 500, y: 300 });
  });

  it('only averages the most recent points', () => {
    const smoother = new FixationSmoother({ radius: 100, window: 2 });
    smoother.push({ x: 0, y: 0 });
    smoother.push({ x: 40, y: 0 });
    expect(smoother.push({ x: 60, y: 0 }).x).toBe(50);
  });

  it('starts fresh after reset', () => {
    const smoother = new FixationSmoother({ radius: 50 });
    smoother.push({ x: 500, y: 300 });
    smoother.reset();
    expect(smoother.push({ x: 10, y: 10 })).toEqual({ x: 10, y: 10 });
  });
});
