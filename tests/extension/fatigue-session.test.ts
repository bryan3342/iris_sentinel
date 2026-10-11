import { describe, expect, it } from 'vitest';
import type { FatigueState } from '@iris/core';
import type { FatigueLevel } from '@iris/protocol';
import { addToSession, duration, emptySession, sessionLines, type FatigueSession } from '../../extension/src/sidepanel/fatigue-session';

/** An engine state with only what the session reads. */
const at = (t: number, score: number | null, level: FatigueLevel = 'fresh', paused: FatigueState['paused'] = null): FatigueState =>
  ({ t, score, level, paused, clues: {} }) as unknown as FatigueState;

/** One state a second from `from` (s) to `to` (s), inclusive, all with `score` and `level`. */
function seconds(session: FatigueSession, from: number, to: number, score: number | null, level: FatigueLevel = 'fresh', paused: FatigueState['paused'] = null): FatigueSession {
  for (let s = from; s <= to; s++) session = addToSession(session, at(s * 1_000, score, level, paused));
  return session;
}

describe('fatigue session', () => {
  it('runs from start to the last state, and counts time at each live level', () => {
    let session = emptySession(0);
    session = seconds(session, 1, 30, null, 'fresh', 'warming-up'); // 30 s warming up: length only
    session = seconds(session, 31, 330, 10); // 5 min fresh
    session = seconds(session, 331, 370, 45, 'tiring'); // 40 s tiring; average (300 x 10 + 40 x 45) / 340 = 14
    expect(sessionLines(session)).toEqual(['Session: 6 min 10 s', 'Average score 14, highest 45', 'Time fresh 5 min 0 s, tiring 40 s', 'Last: tiring (score 45)']);
  });

  it('leaves paused time out of the levels and the average, but keeps the held level as the last result', () => {
    let session = emptySession(0);
    session = seconds(session, 1, 60, 20);
    session = seconds(session, 61, 120, 20, 'fresh', 'no-face');
    expect(session.levelMs.fresh).toBe(60_000);
    expect(session.scoreCount).toBe(60);
    expect(sessionLines(session).at(-1)).toBe('Last: fresh (score 20)');
  });

  it('says so when the signals never got past warming up', () => {
    const session = seconds(emptySession(0), 1, 25, null, 'fresh', 'warming-up');
    expect(sessionLines(session)).toEqual(['Session: 25 s', 'No reading yet: the signals were still warming up.']);
  });

  it('starts at the first state when no start time is given', () => {
    expect(sessionLines(seconds(emptySession(), 5, 15, 12))[0]).toBe('Session: 10 s');
    expect(sessionLines(emptySession())).toEqual(['Session: no readings.']);
  });

  it('writes durations in minutes and seconds', () => {
    expect(duration(40_000)).toBe('40 s');
    expect(duration(380_000)).toBe('6 min 20 s');
    expect(duration(60_000)).toBe('1 min 0 s');
  });
});
