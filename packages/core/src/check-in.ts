import type { FatigueState } from './fatigue';

/**
 * Decides when Iris should check in by voice because the user seems tired: only at the fatigued
 * or strained level, never while the engine is warming up or cannot see the user, never during a
 * conversation or shortly after one, and at most once per cooldown. It reads only the level, so
 * nothing about the user's body reaches the voice agent; what Iris says is one fixed phrase.
 */
export interface CheckInOptions {
  /** Least time between two check-ins, in milliseconds. */
  cooldownMs?: number;
  /** Quiet needed after a conversation before checking in, in milliseconds. */
  afterTalkMs?: number;
}

export class CheckIn {
  private readonly o: Required<CheckInOptions>;
  private last = -Infinity;
  private lastTalk = -Infinity;

  constructor(options: CheckInOptions = {}) {
    this.o = { cooldownMs: 15 * 60_000, afterTalkMs: 2 * 60_000, ...options };
  }

  /** True once when Iris should check in now. `talking`: a conversation is open. */
  update(state: Pick<FatigueState, 'level' | 'paused'>, t: number, talking: boolean): boolean {
    if (talking) this.lastTalk = t;
    const tired = state.level === 'fatigued' || state.level === 'strained';
    if (!tired || state.paused !== null || talking || t - this.lastTalk < this.o.afterTalkMs || t - this.last < this.o.cooldownMs) return false;
    this.last = t;
    return true;
  }
}
