import { FATIGUE_LEVELS, type FatigueLevel } from '@iris/protocol';
import type { FatigueState } from '@iris/core';

// A summary of one fatigue run, built up from the engine's state once a
// second, for the card to show while it runs and once it ends: how long it ran, the average and
// highest score, and the time spent at each level. Time while paused (warming
// up, face out of view) counts toward the length but not toward any level.
// Pure functions over a small value, tested directly. It holds scores and
// levels only, never body readings, and stays in the side panel.

export interface FatigueSession {
  startT: number | null;
  lastT: number | null;
  /** Milliseconds spent at each level while the score was live. */
  levelMs: Record<FatigueLevel, number>;
  scoreSum: number;
  scoreCount: number;
  peak: number | null;
  last: { level: FatigueLevel; score: number | null } | null;
}

/** A new session, started at `startT` (when the user pressed start), or at its first state. */
export const emptySession = (startT: number | null = null): FatigueSession => ({
  startT,
  lastT: null,
  levelMs: { fresh: 0, tiring: 0, fatigued: 0, strained: 0 },
  scoreSum: 0,
  scoreCount: 0,
  peak: null,
  last: null,
});

/** Adds one engine state. The time since the previous state counts toward this state's level if it is live. */
export function addToSession(session: FatigueSession, state: FatigueState): FatigueSession {
  const live = !state.paused && state.score !== null;
  const since = session.lastT ?? session.startT;
  const dt = since === null ? 0 : Math.max(state.t - since, 0);
  return {
    startT: session.startT ?? state.t,
    lastT: state.t,
    levelMs: live ? { ...session.levelMs, [state.level]: session.levelMs[state.level] + dt } : session.levelMs,
    scoreSum: live ? session.scoreSum + state.score! : session.scoreSum,
    scoreCount: live ? session.scoreCount + 1 : session.scoreCount,
    peak: live ? Math.max(session.peak ?? 0, state.score!) : session.peak,
    last: { level: state.level, score: state.score },
  };
}

/** "6 min 20 s", "40 s". */
export function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}

/** The lines the card shows after Stop. */
export function sessionLines(session: FatigueSession): string[] {
  if (session.startT === null || session.lastT === null) return ['Session: no readings.'];
  const lines = [`Session: ${duration(session.lastT - session.startT)}`];
  if (session.scoreCount === 0) return [...lines, 'No reading yet: the signals were still warming up.'];
  lines.push(`Average score ${Math.round(session.scoreSum / session.scoreCount)}, highest ${Math.round(session.peak ?? 0)}`);
  const times = FATIGUE_LEVELS.filter((level) => session.levelMs[level] >= 500).map((level) => `${level} ${duration(session.levelMs[level])}`);
  if (times.length) lines.push(`Time ${times.join(', ')}`);
  const last = session.last!;
  lines.push(`Last: ${last.level}${last.score === null ? '' : ` (score ${Math.round(last.score)})`}`);
  return lines;
}
