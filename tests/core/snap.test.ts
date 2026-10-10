import { describe, expect, it } from 'vitest';
import { distanceToRect, snapToTarget, type SnapTarget } from '@iris/core';

const OPTIONS = { maxDistance: 80, hysteresis: 20 };
const target = (id: number, x: number, y: number, width: number, height: number): SnapTarget => ({ id, rect: { x, y, width, height } });

describe('distanceToRect', () => {
  const rect = { x: 100, y: 100, width: 200, height: 40 };

  it('is zero inside and on the edge', () => {
    expect(distanceToRect({ x: 150, y: 120 }, rect)).toBe(0);
    expect(distanceToRect({ x: 300, y: 140 }, rect)).toBe(0);
  });

  it('measures to the nearest edge or corner', () => {
    expect(distanceToRect({ x: 200, y: 60 }, rect)).toBe(40);
    expect(distanceToRect({ x: 330, y: 180 }, rect)).toBe(50);
  });
});

describe('snapToTarget', () => {
  it('aims at the target the point is inside', () => {
    const targets = [target(1, 0, 0, 100, 40), target(2, 200, 0, 100, 40)];
    expect(snapToTarget({ x: 250, y: 20 }, targets, null, OPTIONS)).toBe(2);
  });

  it('aims at a nearby target measured to its edge, not its center', () => {
    // 30 px from the end of a wide link, but 330 px from its center.
    const targets = [target(1, 0, 0, 600, 40)];
    expect(snapToTarget({ x: 630, y: 20 }, targets, null, OPTIONS)).toBe(1);
  });

  it('aims at nothing when every target is too far', () => {
    expect(snapToTarget({ x: 500, y: 500 }, [target(1, 0, 0, 100, 40)], null, OPTIONS)).toBeNull();
    expect(snapToTarget({ x: 10, y: 10 }, [], 1, OPTIONS)).toBeNull();
  });

  it('prefers the smallest of overlapping targets', () => {
    const card = target(1, 0, 0, 400, 300);
    const button = target(2, 20, 20, 80, 30);
    expect(snapToTarget({ x: 40, y: 30 }, [card, button], null, OPTIONS)).toBe(2);
    // Moving inward from the card to the button inside it is not held back by hysteresis.
    expect(snapToTarget({ x: 40, y: 30 }, [card, button], 1, OPTIONS)).toBe(2);
  });

  it('holds the current aim over targets that overlap without one containing the other', () => {
    const wide = target(1, 0, 0, 300, 40);
    const overlapping = target(2, 250, 0, 100, 40);
    expect(snapToTarget({ x: 270, y: 20 }, [wide, overlapping], 1, OPTIONS)).toBe(1);
    expect(snapToTarget({ x: 270, y: 20 }, [wide, overlapping], null, OPTIONS)).toBe(2);
  });

  it('holds the current aim between two neighbors until another is clearly closer', () => {
    const targets = [target(1, 0, 0, 100, 40), target(2, 0, 60, 100, 40)];
    // Point at y=55 is 15 px from target 1 and 5 px from target 2.
    expect(snapToTarget({ x: 50, y: 55 }, targets, 1, OPTIONS)).toBe(1);
    expect(snapToTarget({ x: 50, y: 55 }, targets, null, OPTIONS)).toBe(2);
    // Inside target 2 and 30 px from target 1: more than the hysteresis, so the aim moves.
    expect(snapToTarget({ x: 50, y: 70 }, targets, 1, OPTIONS)).toBe(2);
  });

  it('does not flicker while jitter crosses the midpoint between neighbors', () => {
    const targets = [target(1, 0, 0, 100, 40), target(2, 0, 60, 100, 40)];
    let aim: number | null = 1;
    for (const y of [48, 52, 49, 53, 47, 51]) aim = snapToTarget({ x: 50, y }, targets, aim, OPTIONS);
    expect(aim).toBe(1);
  });

  it('drops a previous aim that is no longer in the list or in range', () => {
    const targets = [target(2, 0, 0, 100, 40)];
    expect(snapToTarget({ x: 50, y: 20 }, targets, 7, OPTIONS)).toBe(2);
    const far = [target(1, 0, 0, 100, 40), target(2, 0, 200, 100, 40)];
    expect(snapToTarget({ x: 50, y: 210 }, far, 1, OPTIONS)).toBe(2);
  });
});
