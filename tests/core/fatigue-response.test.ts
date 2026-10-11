import { describe, expect, it } from 'vitest';
import { explain, fatigueResponse, FATIGUE_CLUES, type ClueState, type FatigueClue, type FatiguePause, type FatigueState } from '@iris/core';
import { FATIGUE_LEVELS } from '@iris/protocol';

const clue = (value: number | null, baseline: number | null, strain: number | null): ClueState => ({ value, baseline, personal: true, strain });

/** A live engine state: body clues at the user's normal and no click clues yet, with `changes` on top. */
function state(changes: Partial<Record<FatigueClue, ClueState>> = {}, paused: FatiguePause | null = null): FatigueState {
  return {
    t: 0,
    score: 50,
    level: 'tiring',
    paused,
    clues: {
      blink: clue(15, 15, 0),
      hrv: clue(45, 45, 0),
      breathing: clue(14, 14, 0),
      timeToClick: clue(null, null, null),
      landings: clue(null, null, null),
      ...changes,
    },
  };
}

const TIRED = state({
  blink: clue(22.5, 15, 0.5), // +50%, adds 0.5 x 0.25 = 0.125
  hrv: clue(31.5, 45, 2 / 3), // -30%, adds 0.2
  breathing: clue(16.8, 14, 0.4), // +20%, adds 0.06
  timeToClick: clue(1_600, 1_000, 0.47), // +60%, adds about 0.07
});

describe('explain', () => {
  it('lists the clues adding most to the score, strongest first, at most three', () => {
    expect(explain(TIRED)).toEqual(['Heart rate variability down 30%', 'Blink rate up 50%', 'Clicks taking 60% longer']);
  });

  it('leaves out clues within their normal range or without a value', () => {
    expect(explain(state({ blink: clue(17, 15, 0) }))).toEqual([]);
    expect(explain(state({ landings: clue(2, 1, 1) }))).toEqual(['Aim slipping off targets 100% more']);
  });

  it('says why while paused', () => {
    expect(explain(state({}, 'warming-up'))).toEqual(['Waiting for steady signals']);
    expect(explain(state({}, 'no-face'))).toEqual(['Face out of view, paused']);
    expect(explain({ ...TIRED, paused: 'poor-view' })).toEqual(['Camera view unclear, paused']); // the pause, not the clues
    expect(explain({ ...TIRED, paused: 'talking' })).toEqual(['Talking with Iris, paused']);
  });
});

describe('fatigueResponse', () => {
  it('keeps the normal pace when fresh', () => {
    expect(fatigueResponse('fresh')).toEqual({ dwellScale: 1, targetScale: 1, offerReadAloud: false, suggestBreak: false, pauseGazeConfirms: false, summary: 'Normal pace' });
  });

  it('adds help level by level, as in the architecture', () => {
    expect(fatigueResponse('tiring')).toMatchObject({ dwellScale: 1.5, targetScale: 1.25, offerReadAloud: false });
    expect(fatigueResponse('fatigued')).toMatchObject({ offerReadAloud: true, suggestBreak: false });
    expect(fatigueResponse('strained')).toMatchObject({ suggestBreak: true, pauseGazeConfirms: true, summary: 'You might be tired. Time for a break?' });
  });

  it('only ever slows down and enlarges, never the other way, as the level rises', () => {
    const responses = FATIGUE_LEVELS.map(fatigueResponse);
    responses.forEach((r, i) => {
      expect(r.dwellScale).toBeGreaterThanOrEqual(i === 0 ? 1 : responses[i - 1]!.dwellScale);
      expect(r.targetScale).toBeGreaterThanOrEqual(i === 0 ? 1 : responses[i - 1]!.targetScale);
    });
  });

  it('hands out a copy, so a caller cannot change the table', () => {
    fatigueResponse('fresh').dwellScale = 9;
    expect(fatigueResponse('fresh').dwellScale).toBe(1);
  });
});

describe('wording', () => {
  it('stays plain: no em dashes and no medical words in any line Iris can show', () => {
    const everyClue = state(Object.fromEntries(FATIGUE_CLUES.map((c) => [c, clue(2, 1, 1)])));
    const lines = [
      ...explain(everyClue, undefined, FATIGUE_CLUES.length),
      ...(['warming-up', 'no-face', 'poor-view'] as const).flatMap((p) => explain(state({}, p))),
      ...FATIGUE_LEVELS.map((level) => fatigueResponse(level).summary),
    ];
    expect(lines).toHaveLength(FATIGUE_CLUES.length + 3 + FATIGUE_LEVELS.length);
    for (const line of lines) {
      expect(line).not.toMatch(/\u2014/); // em dash
      expect(line).not.toMatch(/diagnos|disease|disorder|symptom|medical|patient|condition/i);
    }
  });
});
