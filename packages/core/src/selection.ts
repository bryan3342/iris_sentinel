import type { ConfirmEvent } from './confirm';

/**
 * Turns a confirm into a selection. A safe target (an ordinary link, or a
 * plainly harmless button) is selected by any confirm. A risky one (anything
 * that may submit, pay, delete or send, or that Iris cannot classify) is
 * selected only by a double blink, which is deliberate, so resting the eyes on
 * a Buy or Delete button never presses it. There is no second confirm: asking
 * the user to look away and back depends on gaze accuracy a webcam cannot
 * give. This holds however the target was proposed, by gaze or by the voice
 * agent. Nothing is ever selected without a confirm.
 */

export interface GateTarget {
  id: number;
  risky: boolean;
}

export type Selection =
  /** Act on this target now. */
  | { kind: 'select'; target: number }
  /** A risky target confirmed some other way: only a double blink opens it. */
  | { kind: 'needs-double-blink'; target: number }
  /** The confirm landed on no target. */
  | { kind: 'none' };

/** What one confirm on `target` (null when it landed on nothing) leads to. */
export function decideSelection(event: ConfirmEvent, target: GateTarget | null): Selection {
  if (!target) return { kind: 'none' };
  if (target.risky && event.source !== 'double-blink') return { kind: 'needs-double-blink', target: target.id };
  return { kind: 'select', target: target.id };
}
