import { describe, expect, it } from 'vitest';
import type { ClueState, FatigueClue, FatigueState } from '@iris/core';
import { fatigueView } from '../../extension/src/sidepanel/fatigue-view';

const clue = (value: number | null, baseline: number | null, strain: number | null): ClueState => ({ value, baseline, personal: true, strain });

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

describe('fatigueView', () => {
  it('says so before the demo runs', () => {
    expect(fatigueView(null)).toEqual({ status: 'Fatigue: not running.', why: [], response: null });
  });

  it('shows warming up without a score or a response', () => {
    expect(fatigueView(state({ score: null, paused: 'warming-up' }))).toEqual({
      status: 'Fatigue: paused.',
      why: ['Waiting for steady signals'],
      response: null,
    });
  });

  it('reassures a rested user', () => {
    expect(fatigueView(state())).toEqual({
      status: 'Fatigue: fresh (score 3).',
      why: ['Signals near your normal'],
      response: 'Iris would: Normal pace',
    });
  });

  it('shows the level, the reasons and what Iris would change', () => {
    const view = fatigueView(state({ score: 47.6, level: 'tiring' }, { blink: clue(22.5, 15, 0.5), hrv: clue(31.5, 45, 2 / 3) }));
    expect(view).toEqual({
      status: 'Fatigue: tiring (score 48).',
      why: ['Heart rate variability down 30%', 'Blink rate up 50%'],
      response: 'Iris would: Slower clicks and larger targets',
    });
  });

  it('keeps the held score while the face is out of view', () => {
    const view = fatigueView(state({ score: 47.6, level: 'tiring', paused: 'no-face' }, { hrv: clue(null, 45, null) }));
    expect(view.status).toBe('Fatigue: paused (score 48).');
    expect(view.why).toEqual(['Face out of view, paused']);
  });
});
