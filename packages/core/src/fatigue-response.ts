import type { FatigueLevel } from '@iris/protocol';
import { CLUE_SETTINGS, FATIGUE_CLUES, type ClueSettings, type FatigueClue, type FatiguePause, type FatigueState } from './fatigue';

/**
 * Turns the fatigue engine's state into words and actions: the short "why"
 * lines the side panel shows, and what Iris changes at each level
 * (docs/architecture.md 3.1). Wording stays plain and never medical: Iris
 * notices that a user might be tired, it never diagnoses. The lines describe
 * body readings, so they are for the side panel only, never for logs, the
 * server or the voice agent.
 */

const PAUSE_LINES: Record<FatiguePause, string> = {
  'warming-up': 'Waiting for steady signals',
  'no-face': 'Face out of view, paused',
  'poor-view': 'Camera view unclear, paused',
};

/** One line per clue, given the change from the user's normal as a whole percent. */
const CLUE_LINES: Record<FatigueClue, (percent: number) => string> = {
  blink: (p) => `Blink rate up ${p}%`,
  hrv: (p) => `Heart rate variability down ${p}%`,
  breathing: (p) => `Breathing rate up ${p}%`,
  timeToClick: (p) => `Clicks taking ${p}% longer`,
  landings: (p) => `Aim slipping off targets ${p}% more`,
};

/**
 * Up to `max` lines on why the score is up, the clue adding the most to the
 * score first (strain times weight). Clues within their normal range are left
 * out, so a rested user gets no lines. While paused, the one line says why.
 */
export function explain(state: FatigueState, settings: Record<FatigueClue, ClueSettings> = CLUE_SETTINGS, max = 3): string[] {
  if (state.paused) return [PAUSE_LINES[state.paused]];
  return FATIGUE_CLUES.flatMap((clue) => {
    const { value, baseline, strain } = state.clues[clue];
    if (value === null || baseline === null || baseline <= 0 || !strain) return [];
    const percent = Math.round((Math.abs(value - baseline) / baseline) * 100);
    return [{ line: CLUE_LINES[clue](percent), weight: strain * settings[clue].weight }];
  })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max)
    .map((reason) => reason.line);
}

export interface FatigueResponse {
  /** Multiplier for the confirm (dwell) time. Never below 1: Iris only ever slows down. */
  dwellScale: number;
  /** Multiplier for the size of page targets. Never below 1. */
  targetScale: number;
  /** Offer to read the page aloud and take requests by voice. */
  offerReadAloud: boolean;
  /** Suggest a break. */
  suggestBreak: boolean;
  /** Stop gaze confirms until the user looks back. */
  pauseGazeConfirms: boolean;
  /** What Iris does at this level, in a few plain words for the side panel. */
  summary: string;
}

const RESPONSES: Record<FatigueLevel, FatigueResponse> = {
  fresh: { dwellScale: 1, targetScale: 1, offerReadAloud: false, suggestBreak: false, pauseGazeConfirms: false, summary: 'Normal pace' },
  tiring: { dwellScale: 1.5, targetScale: 1.25, offerReadAloud: false, suggestBreak: false, pauseGazeConfirms: false, summary: 'Slower clicks and larger targets' },
  fatigued: { dwellScale: 1.5, targetScale: 1.25, offerReadAloud: true, suggestBreak: false, pauseGazeConfirms: false, summary: 'Slower clicks, larger targets, and an offer to read the page aloud' },
  strained: { dwellScale: 2, targetScale: 1.5, offerReadAloud: true, suggestBreak: true, pauseGazeConfirms: true, summary: 'You might be tired. Time for a break?' },
};

/** What Iris changes at a fatigue level. Each level keeps the help of the levels below it. */
export function fatigueResponse(level: FatigueLevel): FatigueResponse {
  return { ...RESPONSES[level] };
}
