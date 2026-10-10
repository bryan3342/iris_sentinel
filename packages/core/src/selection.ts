import type { ConfirmEvent } from './confirm';

/**
 * Turns confirms into selections. A confirm acts on the target aimed at that
 * moment: a safe target is selected at once; a risky one (anything that may
 * submit, pay, delete or send) is only armed, and is selected by a second
 * confirm on the same target within the window. This holds however the
 * target was proposed, by gaze, Gemini or the voice agent. Looking away does
 * not disarm it, because a second dwell needs the eyes to leave and return;
 * the window running out, or a confirm on another target, does. Nothing is
 * ever selected without a confirm.
 */

export interface GateTarget {
  id: number;
  risky: boolean;
}

export type Selection =
  /** Act on this target now. */
  | { kind: 'select'; target: number }
  /** A risky target: ask the user to confirm it once more. */
  | { kind: 'confirm-again'; target: number }
  /** The confirm landed on no target. */
  | { kind: 'none' };

export interface SelectionGateOptions {
  /** How long a risky target waits for its second confirm, in milliseconds. */
  windowMs?: number;
}

export class SelectionGate {
  private readonly windowMs: number;
  private armed: { target: number; t: number } | null = null;

  constructor({ windowMs = 6000 }: SelectionGateOptions = {}) {
    this.windowMs = windowMs;
  }

  /** The risky target waiting for its second confirm at time `t`, or null. */
  pending(t: number): number | null {
    return this.armed && t - this.armed.t <= this.windowMs ? this.armed.target : null;
  }

  /** Handles one confirm on the target aimed when it happened. */
  confirm(event: ConfirmEvent, aimed: GateTarget | null): Selection {
    if (!aimed) return { kind: 'none' };
    const waiting = this.pending(event.t);
    this.armed = null;
    if (!aimed.risky || waiting === aimed.id) return { kind: 'select', target: aimed.id };
    this.armed = { target: aimed.id, t: event.t };
    return { kind: 'confirm-again', target: aimed.id };
  }

  /** Forgets an armed target, for example when the page changes underneath it. */
  reset(): void {
    this.armed = null;
  }
}
