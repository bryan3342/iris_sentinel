import { describe, expect, it } from 'vitest';
import type { ClueState, FatigueClue, FatigueState } from '@iris/core';
import { addToSession, emptySession } from '../../extension/src/sidepanel/fatigue-session';
import { fatigueView } from '../../extension/src/sidepanel/fatigue-view';

const clue = (value: number | null, baseline: number | null, strain: number | null, personal = true): ClueState => ({ value, baseline, personal, strain });

function state(overrides: Partial<FatigueState> = {}, clues: Partial<Record<FatigueClue, ClueState>> = {}): FatigueState {
  return {
    t: 0,
    score: 3.4,
    level: 'fresh',
    paused: null,
    clues: {
      blink: clue(15, 15, 0),
      hrv: clue(45, 45, 0),
      breathing: clue(14, 14, 0),
      timeToClick: clue(null, null, null),
      landings: clue(null, null, null),
      ...clues,
    },
    ...overrides,
  };
}

describe('fatigueView while measuring', () => {
  it('says it is starting before the first state', () => {
    expect(fatigueView(null)).toMatchObject({ status: 'Fatigue: starting.', signals: [], summary: [] });
  });

  it('shows warming up without a score, and which signals are still waiting', () => {
    const view = fatigueView(state({ score: null, paused: 'warming-up' }, { hrv: clue(null, 40, null, false), breathing: clue(null, 14, null, false) }));
    expect(view.status).toBe('Fatigue: paused.');
    expect(view.why).toEqual(['Waiting for steady signals']);
    expect(view.signals).toEqual([
      'Blink rate: 15 a minute (your normal 15, 0%)',
      'Heart rate variability: waiting for steady readings',
      'Breathing: waiting for steady readings',
    ]);
    expect(view.response).toBeNull();
  });

  it('shows each signal against the user\'s normal, or a typical value before it is learned', () => {
    const view = fatigueView(state({}, { blink: clue(17, 15, 0), hrv: clue(41, 44, 0), breathing: clue(15, 14, 0, false) }));
    expect(view.signals).toEqual([
      'Blink rate: 17 a minute (your normal 15, +13%)',
      'Heart rate variability: 41 ms (your normal 44, -7%)',
      'Breathing: 15 a minute (typical 14, +7%)',
    ]);
    expect(view.why).toEqual(['Signals near your normal', 'Still learning your normal']);
    expect(view.note).toBe('Estimates from the camera, not medical readings.');
  });

  it('shows the level, the reasons and what Iris would change', () => {
    const view = fatigueView(state({ score: 47.6, level: 'tiring' }, { blink: clue(22.5, 15, 0.5), hrv: clue(31.5, 45, 2 / 3) }));
    expect(view.status).toBe('Fatigue: tiring (score 48).');
    expect(view.why).toEqual(['Heart rate variability down 30%', 'Blink rate up 50%']);
    expect(view.response).toBe('Iris would: Slower clicks and larger targets');
  });

  it('shows how long it has been running and the scores so far, so the user can see it is tracking', () => {
    const session = addToSession(emptySession(0), state({ t: 45_000 }));
    expect(fatigueView(state({ t: 45_000 }), { session }).progress).toBe('Measuring for 45 s, average 3, highest 3');
    expect(fatigueView(state({ t: 45_000 }), { session, mode: 'demo' }).progress).toBe('Demo running for 45 s, average 3, highest 3');
    const warming = addToSession(emptySession(0), state({ t: 10_000, score: null, paused: 'warming-up' }));
    expect(fatigueView(state({ t: 10_000, score: null, paused: 'warming-up' }), { session: warming }).progress).toBe('Measuring for 10 s');
    expect(fatigueView(null, { session: emptySession(0) }).progress).toBe('Measuring for 0 s');
    expect(fatigueView(state(), { running: false, session }).progress).toBeNull();
  });

  it('keeps the held score while the face is out of view', () => {
    const view = fatigueView(state({ score: 47.6, level: 'tiring', paused: 'no-face' }, { hrv: clue(null, 45, null) }));
    expect(view.status).toBe('Fatigue: paused (score 48).');
    expect(view.why).toEqual(['Face out of view, paused']);
  });
});

describe('fatigueView after Stop', () => {
  it('says it is not running when nothing was measured', () => {
    expect(fatigueView(null, { running: false })).toMatchObject({ status: 'Fatigue: not running.', summary: [], signals: [] });
  });

  it('replaces the live view with the session summary', () => {
    const session = [state({ t: 1_000 }), state({ t: 2_000, score: 40, level: 'tiring' })].reduce(addToSession, emptySession(0));
    const view = fatigueView(state({ t: 2_000 }), { running: false, session });
    expect(view.status).toBe('Fatigue: stopped.');
    expect(view.summary).toEqual(['Session: 2 s', 'Average score 22, highest 40', 'Time fresh 1 s, tiring 1 s', 'Last: tiring (score 40)']);
    expect(view.signals).toEqual([]);
    expect(view.response).toBeNull();
  });
});
