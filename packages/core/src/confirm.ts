import type { GazeSample, Unsubscribe } from '@iris/protocol';

/**
 * Confirms: the user saying "yes, that one" without a click. Every confirm
 * method (dwell, double blink, and a stand-in for tests)
 * produces the same event, so whatever acts on it cannot tell them apart and
 * swapping one method for another changes nothing downstream. The event says
 * when the user confirmed; the consumer acts on the target aimed at that
 * moment, unless the event already carries one (a double blink locks its target
 * before the first blink). Looking alone never produces one.
 */

export type ConfirmSource = 'dwell' | 'double-blink' | 'stand-in';

export interface ConfirmEvent {
  /** Timestamp in milliseconds, on the gaze samples' clock. */
  t: number;
  source: ConfirmSource;
  /**
   * The target confirmed, when the method locked it earlier than the confirm itself; null when the
   * method found no target to lock (nothing is selected unless one was picked another way).
   */
  target?: number | null;
}

/** Where confirm events from every method meet. */
export class ConfirmChannel {
  private readonly listeners = new Set<(event: ConfirmEvent) => void>();

  emit(event: ConfirmEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  onConfirm(listener: (event: ConfirmEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export interface DwellOptions {
  /**
   * How long one target must stay aimed, in milliseconds. Gaze dwell commonly
   * uses 500 to 1000 ms; webcam aim is jittery, so the default sits at the slow
   * end. Raise it as fatigue rises.
   */
  dwellMs?: number;
}

/**
 * Dwell: a confirm when the same target stays aimed for `dwellMs` while the
 * eyes are open. It fires once per dwell; looking at another target, at
 * nothing, or closing the eyes starts over, so holding still on one target
 * never repeats it.
 */
export class DwellDetector {
  private readonly dwellMs: number;
  private target: number | null = null;
  private since = 0;
  private fired = false;

  constructor({ dwellMs = 1000 }: DwellOptions = {}) {
    this.dwellMs = dwellMs;
  }

  /** Feeds one gaze sample and the aim after it; returns a confirm when a dwell completes. */
  update(sample: GazeSample, aim: number | null): ConfirmEvent | null {
    const looking = sample.eye !== null ? aim : null; // closed eyes hold the aim but are not a dwell
    if (looking !== this.target) {
      this.target = looking;
      this.since = sample.t;
      this.fired = false;
      return null;
    }
    if (looking === null || this.fired || sample.t - this.since < this.dwellMs) return null;
    this.fired = true;
    return { t: sample.t, source: 'dwell' };
  }

  reset(): void {
    this.target = null;
    this.fired = false;
  }
}
