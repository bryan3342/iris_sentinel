import { describe, expect, it } from 'vitest';
import { CalibrationStore, GazeAim, GazePointer, type SnapTarget } from '@iris/core';
import type { GazeSample, HeadPose, Point2 } from '@iris/protocol';

const VIEWPORT = { width: 1000, height: 800 };
const HEAD: HeadPose = { yaw: 0, pitch: 0, eyes: { x: 0.5, y: 0.5 }, eyeSpan: 0.2 };
const OPEN = { left: 0, right: 0 };
// A noiseless eye that moves linearly with the point looked at (a viewport fraction).
const eyeFor = (p: Point2): Point2 => ({ x: (p.x - 0.5) * 0.8, y: (p.y - 0.5) * 0.6 });
const look = (px: number, py: number, t = 0): GazeSample => ({ t, eye: eyeFor({ x: px / VIEWPORT.width, y: py / VIEWPORT.height }), head: HEAD, blink: OPEN });
const closed = (t = 0): GazeSample => ({ t, eye: null, head: HEAD, blink: { left: 1, right: 1 } });

function calibrated(): CalibrationStore {
  const store = new CalibrationStore();
  const dots = [0.05, 0.5, 0.95].flatMap((y) => [0.05, 0.5, 0.95].map((x) => ({ x, y })));
  store.setDots(dots.flatMap((target) => [0, 1, 2].map(() => ({ eye: eyeFor(target), head: HEAD, target }))), VIEWPORT);
  return store;
}
const target = (id: number, x: number, y: number): SnapTarget => ({ id, rect: { x, y, width: 120, height: 30 } });

describe('GazePointer', () => {
  it('has no point until there is a calibration', () => {
    const pointer = new GazePointer(new CalibrationStore());
    expect(pointer.update(look(300, 200), VIEWPORT)).toBeNull();
  });

  it('maps a look to page pixels and holds it while the eyes are closed', () => {
    const pointer = new GazePointer(calibrated());
    const p = pointer.update(look(300, 200), VIEWPORT)!;
    expect(Math.hypot(p.x - 300, p.y - 200)).toBeLessThan(2);
    expect(pointer.update(closed(), VIEWPORT)).toEqual(p);
  });

  it('turns a confirm near the gaze into calibration, and ignores one far away', () => {
    const store = calibrated();
    const pointer = new GazePointer(store);
    expect(pointer.confirm({ x: 300, y: 200 }, VIEWPORT)).toBe(false); // no recent samples yet
    for (let t = 0; t < 10; t++) pointer.update(look(300, 200, t), VIEWPORT);
    expect(pointer.confirm({ x: 310, y: 205 }, VIEWPORT)).toBe(true);
    expect(pointer.confirm({ x: 900, y: 700 }, VIEWPORT)).toBe(false);
    expect(store.samples.filter((s) => s.source === 'confirm')).toHaveLength(1);
  });
});

describe('GazeAim', () => {
  it('aims at nothing before it has a target list', () => {
    const aim = new GazeAim(new GazePointer(calibrated()));
    expect(aim.update(look(300, 200))).toBeNull();
  });

  it('aims at the target nearest the gaze, and at nothing when all are far', () => {
    const aim = new GazeAim(new GazePointer(calibrated()));
    aim.setTargets([target(1, 100, 100), target(2, 600, 100)], VIEWPORT);
    expect(aim.update(look(640, 110))).toBe(2);
    const far = new GazeAim(new GazePointer(calibrated()));
    far.setTargets([target(1, 100, 100)], VIEWPORT);
    expect(far.update(look(800, 700))).toBeNull();
  });

  it('holds the aim while the eyes are closed or the face is lost', () => {
    const aim = new GazeAim(new GazePointer(calibrated()));
    aim.setTargets([target(1, 100, 100), target(2, 600, 100)], VIEWPORT);
    aim.update(look(160, 115));
    expect(aim.update(closed())).toBe(1);
  });

  it('re-snaps from the last gaze point when a fresh scan renumbers the targets', () => {
    const aim = new GazeAim(new GazePointer(calibrated()));
    aim.setTargets([target(1, 100, 100), target(2, 600, 100)], VIEWPORT);
    aim.update(look(640, 110));
    // The page scrolled: the same button is now target 5, and an old ID means nothing.
    expect(aim.setTargets([target(4, 100, 60), target(5, 600, 90)], VIEWPORT)).toBe(5);
    expect(aim.setTargets([target(9, 100, 500)], VIEWPORT)).toBeNull();
  });
});
