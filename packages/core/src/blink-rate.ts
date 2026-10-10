import type { BlinkEvent, QualityStatus } from '@iris/protocol';
import type { ConfirmEvent } from './confirm';

/**
 * Natural blinks per minute over a rolling window, one of the fatigue clues:
 * blink rate rises as people tire. Presage misses some blinks, but the rate is
 * only ever compared with the same user's own baseline, so a steady undercount
 * cancels out. A blink close to a double-blink confirm is dropped, so confirming
 * never reads as tiredness. Nothing counts until the camera view is reported
 * `ok`, and the window starts over whenever it stops being `ok`. Blink times
 * stay in memory only.
 */

export interface BlinkRateOptions {
  /** Length of the rolling window, in milliseconds. */
  windowMs?: number;
  /** How long the view must have been `ok` before a rate is reported, in milliseconds. */
  minCoverageMs?: number;
  /** A blink this long before a double-blink confirm is dropped, in milliseconds; both blinks of the pair come before it. */
  confirmBeforeMs?: number;
  /** A blink this long after a double-blink confirm is dropped, in milliseconds. Presage reports a blink after the eyes reopen. */
  confirmAfterMs?: number;
}

const MINUTE_MS = 60_000;

export class BlinkRateMeter {
  private readonly windowMs: number;
  private readonly minCoverageMs: number;
  private readonly confirmBeforeMs: number;
  private readonly confirmAfterMs: number;
  private blinks: number[] = [];
  private confirms: number[] = [];
  /** Start of the current stretch of `ok` view, or null while the view is not `ok`. */
  private since: number | null = null;

  constructor({ windowMs = 60_000, minCoverageMs = 30_000, confirmBeforeMs = 900, confirmAfterMs = 2_000 }: BlinkRateOptions = {}) {
    this.windowMs = windowMs;
    this.minCoverageMs = minCoverageMs;
    this.confirmBeforeMs = confirmBeforeMs;
    this.confirmAfterMs = confirmAfterMs;
  }

  addBlink(blink: BlinkEvent): void {
    if (this.since === null) return; // a blink seen through a poor view is not trusted
    this.blinks = [...this.keepRecent(this.blinks, blink.t), blink.t];
  }

  /** Only double-blink confirms matter: a dwell or stand-in confirm involves no blink. */
  addConfirm(event: ConfirmEvent): void {
    if (event.source !== 'double-blink') return;
    this.confirms = [...this.keepRecent(this.confirms, event.t), event.t];
  }

  setQuality(status: QualityStatus): void {
    if (status.quality === 'ok') {
      this.since ??= status.t;
    } else {
      this.since = null;
      this.blinks = [];
    }
  }

  /** Blinks per minute at time `t`, or null until the view has been `ok` for `minCoverageMs`. */
  rate(t: number): number | null {
    if (this.since === null || t - this.since < this.minCoverageMs) return null;
    const from = Math.max(this.since, t - this.windowMs);
    if (t <= from) return null;
    const counted = this.blinks.filter((b) => b > from && b <= t && !this.nearConfirm(b)).length;
    return counted / ((t - from) / MINUTE_MS);
  }

  reset(): void {
    this.blinks = [];
    this.confirms = [];
    this.since = null;
  }

  private nearConfirm(blink: number): boolean {
    return this.confirms.some((c) => blink >= c - this.confirmBeforeMs && blink <= c + this.confirmAfterMs);
  }

  /** Drops times too old to matter for any window ending at or after `now`. */
  private keepRecent(times: number[], now: number): number[] {
    const oldest = now - this.windowMs - this.confirmAfterMs;
    return times.filter((time) => time >= oldest);
  }
}
