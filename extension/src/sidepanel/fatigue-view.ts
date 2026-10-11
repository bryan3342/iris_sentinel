import { explain, fatigueResponse, type FatigueClue, type FatigueState } from '@iris/core';
import { duration, sessionLines, type FatigueSession } from './fatigue-session';

// What the side panel's fatigue card shows, as a pure function of the engine's
// state: the level and score, the "why" lines, each body signal against the
// user's normal, and what Iris would change; once a run ends (the demo is
// stopped or the companion disconnects), a summary of it. No DOM here, so it
// is tested directly; fatigue-panel.ts renders it.
// Wording is plain and never medical, and none of it leaves the side panel.

export interface FatigueCardView {
  /** The level and score, for example "Fatigue: tiring (score 48)". */
  status: string;
  /** Why the score is where it is, strongest first. */
  why: string[];
  /** Each body signal against the user's normal, while running. */
  signals: string[];
  /** What Iris would change at this level, or null before there is a level worth acting on. */
  response: string | null;
  /** The session summary, once a run ends. */
  summary: string[];
  /** Shown with the signals. */
  note: string | null;
  /** How long it has been running and the scores so far, ticking every second so the user can see it is tracking. */
  progress: string | null;
}

export interface FatigueViewOptions {
  /** False once a run ends: the session summary replaces the live view. */
  running?: boolean;
  session?: FatigueSession | null;
  /** What is running, for the progress line. */
  mode?: 'live' | 'demo';
}

/** The body clues the card reports on. Click clues join once clicks feed the engine. */
const BODY_CLUES: { clue: FatigueClue; name: string; unit: string }[] = [
  { clue: 'blink', name: 'Blink rate', unit: ' a minute' },
  { clue: 'hrv', name: 'Heart rate variability', unit: ' ms' },
  { clue: 'breathing', name: 'Breathing', unit: ' a minute' },
];

const scoreText = (state: FatigueState) => (state.score === null ? '' : ` (score ${Math.round(state.score)})`);

/** "Blink rate: 17 a minute (your normal 15, +13%)", or "Blink rate: waiting for steady readings". */
function signalLine(state: FatigueState, { clue, name, unit }: (typeof BODY_CLUES)[number]): string {
  const { value, baseline, personal } = state.clues[clue];
  if (value === null) return `${name}: waiting for steady readings`;
  if (baseline === null || baseline <= 0) return `${name}: ${Math.round(value)}${unit}`;
  const change = Math.round(((value - baseline) / baseline) * 100);
  const normal = personal ? 'your normal' : 'typical';
  return `${name}: ${Math.round(value)}${unit} (${normal} ${Math.round(baseline)}, ${change > 0 ? '+' : ''}${change}%)`;
}

export function fatigueView(state: FatigueState | null, { running = true, session = null, mode = 'live' }: FatigueViewOptions = {}): FatigueCardView {
  const empty = { why: [], signals: [], response: null, summary: [], note: null, progress: null };
  if (!running) {
    if (session && session.startT !== null) return { ...empty, status: 'Fatigue: stopped.', summary: sessionLines(session) };
    return { ...empty, status: 'Fatigue: not running.' };
  }
  const elapsed = session?.startT != null && session.lastT != null ? duration(session.lastT - session.startT) : '0 s';
  const soFar = session && session.scoreCount > 0 ? `, average ${Math.round(session.scoreSum / session.scoreCount)}, highest ${Math.round(session.peak ?? 0)}` : '';
  const progress = `${mode === 'demo' ? 'Demo running' : 'Measuring'} for ${elapsed}${soFar}`;
  if (!state) return { ...empty, status: 'Fatigue: starting.', progress };

  const status = state.paused ? `Fatigue: paused${scoreText(state)}.` : `Fatigue: ${state.level}${scoreText(state)}.`;
  const why = explain(state);
  if (!state.paused && why.length === 0) why.push('Signals near your normal');
  const learning = BODY_CLUES.some(({ clue }) => state.clues[clue].value !== null && !state.clues[clue].personal);
  if (!state.paused && learning) why.push('Still learning your normal');
  return {
    status,
    why,
    signals: BODY_CLUES.map((clue) => signalLine(state, clue)),
    response: state.score === null ? null : `Iris would: ${fatigueResponse(state.level).summary}`,
    summary: [],
    note: 'Estimates from the camera, not medical readings.',
    progress,
  };
}
