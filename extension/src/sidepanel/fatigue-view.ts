import { explain, fatigueResponse, type FatigueState } from '@iris/core';

// What the side panel's fatigue card shows, as a pure function of the engine's
// state: the level and score, the "why" lines, and what Iris would change. No
// DOM here, so it is tested directly; fatigue-panel.ts renders it. Wording is
// plain and never medical, and none of it leaves the side panel.

export interface FatigueCardView {
  /** The level and score, for example "Fatigue: tiring (score 48)". */
  status: string;
  /** Why the score is where it is, strongest first. */
  why: string[];
  /** What Iris would change at this level, or null before there is a level worth acting on. */
  response: string | null;
}

export function fatigueView(state: FatigueState | null): FatigueCardView {
  if (!state) return { status: 'Fatigue: not running.', why: [], response: null };
  const score = state.score === null ? '' : ` (score ${Math.round(state.score)})`;
  const status = state.paused ? `Fatigue: paused${score}.` : `Fatigue: ${state.level}${score}.`;
  const why = explain(state);
  if (!state.paused && why.length === 0) why.push('Signals near your normal');
  return { status, why, response: state.score === null ? null : `Iris would: ${fatigueResponse(state.level).summary}` };
}
