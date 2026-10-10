import { describe, expect, it } from 'vitest';
import { SettledAim } from '@iris/core';

type Aim = { id: number; scan: number };
const same = (a: Aim, b: Aim) => a.id === b.id;

describe('SettledAim', () => {
  it('counts a target only once it has been aimed at for the hold time', () => {
    const aim = new SettledAim<Aim>(same, 800);
    aim.update({ id: 1, scan: 0 }, 0);
    expect(aim.get(500)).toBeNull();
    expect(aim.get(800)).toEqual({ id: 1, scan: 0 });
  });

  it('keeps the rested-on target while the aim glances across others on the way to a button', () => {
    const aim = new SettledAim<Aim>(same, 800);
    aim.update({ id: 1, scan: 0 }, 0);
    aim.update({ id: 2, scan: 0 }, 1000); // passing over
    aim.update({ id: 3, scan: 0 }, 1200); // passing over
    aim.update(null, 1300); // left the page
    expect(aim.get(1500)).toEqual({ id: 1, scan: 0 });
  });

  it('a fresh scan of the same target neither restarts the hold nor keeps a stale copy', () => {
    const aim = new SettledAim<Aim>(same, 800);
    aim.update({ id: 1, scan: 0 }, 0);
    aim.update({ id: 1, scan: 1 }, 500);
    expect(aim.get(800)).toEqual({ id: 1, scan: 1 });
  });

  it('a newly rested-on target replaces the old one, and reset forgets both', () => {
    const aim = new SettledAim<Aim>(same, 800);
    aim.update({ id: 1, scan: 0 }, 0);
    aim.update({ id: 2, scan: 0 }, 1000);
    expect(aim.get(1900)).toEqual({ id: 2, scan: 0 });
    aim.reset();
    expect(aim.get(5000)).toBeNull();
  });
});
