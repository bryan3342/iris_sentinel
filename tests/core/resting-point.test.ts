import { describe, expect, it } from 'vitest';
import { RestingPoint } from '@iris/core';

const FRAME = 33;
/** Feeds `ms` of gaze at `at` (null: eyes closed) from `from`; returns where it ended. */
function look(rest: RestingPoint, from: number, ms: number, at: ((t: number) => { x: number; y: number } | null)): number {
  let t = from;
  for (; t < from + ms; t += FRAME) rest.push(at(t), t);
  return t;
}

describe('RestingPoint', () => {
  it('finds where the eyes rested, even after they moved on', () => {
    const rest = new RestingPoint();
    let t = look(rest, 0, 1500, (t) => ({ x: 400 + (Math.floor(t / FRAME) % 3) * 10, y: 300 })); // reading one paragraph, with jitter
    t = look(rest, t, 600, () => ({ x: 1200, y: 50 })); // glanced elsewhere while speaking
    const at = rest.point(t)!;
    expect(at.x).toBeCloseTo(410, -1);
    expect(at.y).toBe(300);
  });

  it('is null when the eyes never settled, or only settled too long ago', () => {
    const rest = new RestingPoint();
    let t = look(rest, 0, 2000, (t) => ({ x: (t * 7) % 1600, y: (t * 3) % 900 })); // scanning
    expect(rest.point(t)).toBeNull();
    t = look(rest, t, 1500, () => ({ x: 500, y: 500 }));
    t = look(rest, t, 6000, () => null); // eyes closed for six seconds
    expect(rest.point(t)).toBeNull();
  });

  it('forgets everything on clear, such as when the tab changes', () => {
    const rest = new RestingPoint();
    const t = look(rest, 0, 1500, () => ({ x: 500, y: 500 }));
    rest.clear();
    expect(rest.point(t)).toBeNull();
  });
});
