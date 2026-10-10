import { describe, expect, it } from 'vitest';
import { applyCalibration, CalibrationStore, type StoredSample } from '@iris/core';
import type { HeadPose, Point2 } from '@iris/protocol';

const VIEWPORT = { width: 1000, height: 600 };
const LEVEL: HeadPose = { yaw: 0, pitch: 0, eyes: { x: 0.5, y: 0.5 }, eyeSpan: 0.2 };
const DISTANCE_CM = 60;
const PX_PER_CM = 96 / 2.54;
const CORNERS = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.1, y: 0.9 }, { x: 0.9, y: 0.9 }, { x: 0.5, y: 0.5 }];

/** Eye position a simulated user shows while looking at `target` with a still head. */
const eyeFor = (target: Point2): Point2 => ({ x: (target.x - 0.5) * 0.8, y: (target.y - 0.5) * 0.6 });

function dots(noise = 0, perDot = 20, targets = CORNERS): StoredSample[] {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  return targets.flatMap((target) =>
    Array.from({ length: perDot }, () => {
      const eye = eyeFor(target);
      return { eye: { x: eye.x + random() * noise, y: eye.y + random() * noise }, head: LEVEL, target, source: 'dot' as const };
    }),
  );
}

const errorAt = (store: CalibrationStore, target: Point2, head = LEVEL) => {
  const p = applyCalibration(store.model!, eyeFor(target), head, VIEWPORT);
  return Math.hypot(p.x - target.x, p.y - target.y);
};

describe('CalibrationStore', () => {
  it('has no fit until three distinct targets have been seen', () => {
    const store = new CalibrationStore();
    expect(store.model).toBeNull();
    expect(store.addConfirmed(eyeFor({ x: 0.2, y: 0.2 }), LEVEL, { x: 0.2, y: 0.2 }, VIEWPORT)).toBe(true);
    expect(store.addConfirmed(eyeFor({ x: 0.8, y: 0.2 }), LEVEL, { x: 0.8, y: 0.2 }, VIEWPORT)).toBe(true);
    expect(store.model).toBeNull();
    store.addConfirmed(eyeFor({ x: 0.5, y: 0.8 }), LEVEL, { x: 0.5, y: 0.8 }, VIEWPORT);
    expect(store.model).not.toBeNull();
    expect(errorAt(store, { x: 0.4, y: 0.6 })).toBeLessThan(0.02);
  });

  it('refines a rough fit from confirmed targets', () => {
    const store = new CalibrationStore(dots(0.08, 4), VIEWPORT);
    const before = errorAt(store, { x: 0.35, y: 0.65 });
    const grid = [0.2, 0.5, 0.8].flatMap((y) => [0.2, 0.5, 0.8].map((x) => ({ x, y })));
    for (const target of [...grid, ...grid]) store.addConfirmed(eyeFor(target), LEVEL, target, VIEWPORT);
    expect(errorAt(store, { x: 0.35, y: 0.65 })).toBeLessThan(before);
    expect(errorAt(store, { x: 0.35, y: 0.65 })).toBeLessThan(0.03);
  });

  it('ignores a confirm far from where the fit says the user looked', () => {
    const store = new CalibrationStore(dots(), VIEWPORT);
    const lookingAt = { x: 0.2, y: 0.2 };
    expect(store.addConfirmed(eyeFor(lookingAt), LEVEL, { x: 0.8, y: 0.8 }, VIEWPORT)).toBe(false);
    expect(store.samples.filter((s) => s.source === 'confirm')).toHaveLength(0);
    expect(store.addConfirmed(eyeFor(lookingAt), LEVEL, { x: 0.25, y: 0.22 }, VIEWPORT)).toBe(true);
  });

  it('accepts confirms made with the head turned and keeps the map right for both positions', () => {
    const store = new CalibrationStore(dots(), VIEWPORT);
    const turned = { ...LEVEL, yaw: 0.15 };
    const shift = (DISTANCE_CM * Math.tan(0.15) * PX_PER_CM) / VIEWPORT.width;
    for (const target of [{ x: 0.3, y: 0.3 }, { x: 0.6, y: 0.7 }, { x: 0.4, y: 0.5 }]) {
      expect(store.addConfirmed(eyeFor({ x: target.x + shift, y: target.y }), turned, target, VIEWPORT)).toBe(true);
    }
    expect(errorAt(store, { x: 0.7, y: 0.4 })).toBeLessThan(0.02);
    const later = applyCalibration(store.model!, eyeFor({ x: 0.7 + shift, y: 0.4 }), turned, VIEWPORT);
    expect(later.x).toBeCloseTo(0.7, 2);
  });

  it('keeps only the most recent confirms', () => {
    const store = new CalibrationStore(dots(), VIEWPORT, { maxConfirmed: 5 });
    for (let i = 0; i < 8; i++) {
      const target = { x: 0.2 + i * 0.08, y: 0.5 };
      store.addConfirmed(eyeFor(target), LEVEL, target, VIEWPORT);
    }
    const kept = store.samples.filter((s) => s.source === 'confirm');
    expect(kept).toHaveLength(5);
    expect(kept[0]!.target.x).toBeCloseTo(0.2 + 3 * 0.08);
  });

  it('replaces the dots on a new dot run and keeps the confirms', () => {
    const store = new CalibrationStore(dots(), VIEWPORT);
    store.addConfirmed(eyeFor({ x: 0.5, y: 0.3 }), LEVEL, { x: 0.5, y: 0.3 }, VIEWPORT);
    store.setDots(dots(0, 3), VIEWPORT);
    expect(store.samples.filter((s) => s.source === 'dot')).toHaveLength(15);
    expect(store.samples.filter((s) => s.source === 'confirm')).toHaveLength(1);
  });

  it('rebuilds the same fit from its saved samples', () => {
    const store = new CalibrationStore(dots(0.02), VIEWPORT);
    store.addConfirmed(eyeFor({ x: 0.5, y: 0.3 }), LEVEL, { x: 0.5, y: 0.3 }, VIEWPORT);
    const restored = new CalibrationStore(JSON.parse(JSON.stringify(store.samples)), VIEWPORT);
    expect(restored.model).toEqual(store.model);
  });
});
