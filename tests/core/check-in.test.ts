import { describe, expect, it } from 'vitest';
import { CheckIn } from '@iris/core';
import type { FatigueLevel } from '@iris/protocol';
import type { FatiguePause } from '@iris/core';

const MIN = 60_000;
const at = (level: FatigueLevel, paused: FatiguePause | null = null) => ({ level, paused });
/** Runs one update a second from `from` for `ms` at `state`; returns the times it checked in. */
function run(check: CheckIn, from: number, ms: number, state: ReturnType<typeof at>, talking = false): number[] {
  const fired: number[] = [];
  for (let t = from; t < from + ms; t += 1_000) if (check.update(state, t, talking)) fired.push(t);
  return fired;
}

describe('CheckIn', () => {
  it('checks in once when the user becomes fatigued, then waits fifteen minutes', () => {
    const check = new CheckIn();
    expect(run(check, 0, 10 * MIN, at('tiring'))).toEqual([]);
    expect(run(check, 10 * MIN, 20 * MIN, at('fatigued'))).toEqual([10 * MIN, 25 * MIN]);
    expect(run(check, 30 * MIN, 5 * MIN, at('strained'))).toEqual([]); // still within fifteen minutes of the last
  });

  it('never checks in while warming up or unable to see the user', () => {
    const check = new CheckIn();
    expect(run(check, 0, MIN, at('strained', 'warming-up'))).toEqual([]);
    expect(run(check, MIN, MIN, at('strained', 'no-face'))).toEqual([]);
  });

  it('never interrupts a conversation, and waits two minutes after one', () => {
    const check = new CheckIn();
    expect(run(check, 0, 5 * MIN, at('fatigued'), true)).toEqual([]);
    expect(run(check, 5 * MIN, 3 * MIN, at('fatigued'))).toEqual([5 * MIN + 2 * MIN - 1_000]);
  });
});
