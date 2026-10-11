import type { BlinkEvent, Quality, QualityStatus } from '@iris/protocol';
import type { ConfirmEvent } from './confirm';

/**
 * Natural blinks per minute over a rolling window, one of the fatigue clues:
 * blink rate rises as people tire. Presage misses some blinks, but the rate is
 * only ever compared with the same user's own baseline, so a steady undercount
 * cancels out. A blink close to a double-blink confirm is dropped, so confirming
 * never reads as tiredness. Only blinks seen while the face is in view count,
 * and the rate divides them by the time the face was in view within the
 * window, so a brief camera glitch costs a few seconds of coverage instead of
 * starting the count over. Time while the user talks is left out the same way,
 * since talking changes how often people blink. Blink times stay in memory only.
 */

export interface BlinkRateOptions {
  /** Length of the rolling window, in milliseconds. */
  windowMs?: number;
  /** How much of the window blinks must have counted (face in view, user not talking) before a rate is reported, in milliseconds. */
  minCoverageMs?: number;
  /** A blink this long before a double-blink confirm is dropped, in milliseconds; both blinks of the pair come before it. */
  confirmBeforeMs?: number;
  /** A blink this long after a double-blink confirm is dropped, in milliseconds. Presage reports a blink after the eyes reopen. */
  confirmAfterMs?: number;
}

const MINUTE_MS = 60_000;
/** Views with the face in sight, so its blinks can be trusted. Without the chest, only breathing is lost. */
const FACE_IN_VIEW: readonly Quality[] = ['ok', 'chest-not-visible'];

export class BlinkRateMeter {
  private readonly windowMs: number;
  private readonly minCoverageMs: number;
  private readonly confirmBeforeMs: number;
  private readonly confirmAfterMs: number;
  private blinks: number[] = [];
  private confirms: number[] = [];
  /** Stretches when blinks count (face in view, user not talking); the last one is open (`end` null) while they still do. */
  private views: { start: number; end: number | null }[] = [];
  private faceInView = false;
  private talking = false;

  constructor({ windowMs = 60_000, minCoverageMs = 30_000, confirmBeforeMs = 900, confirmAfterMs = 2_000 }: BlinkRateOptions = {}) {
    this.windowMs = windowMs;
    this.minCoverageMs = minCoverageMs;
    this.confirmBeforeMs = confirmBeforeMs;
    this.confirmAfterMs = confirmAfterMs;
  }

  addBlink(blink: BlinkEvent): void {
    if (!this.counting) return; // a blink seen through a poor view, or while talking, is not counted
    this.blinks = [...this.keepRecent(this.blinks, blink.t), blink.t];
  }

  /** Only double-blink confirms matter: a dwell or stand-in confirm involves no blink. */
  addConfirm(event: ConfirmEvent): void {
    if (event.source !== 'double-blink') return;
    this.confirms = [...this.keepRecent(this.confirms, event.t), event.t];
  }

  setQuality(status: QualityStatus): void {
    this.faceInView = FACE_IN_VIEW.includes(status.quality);
    this.track(status.t);
  }

  /** Whether the user is talking at `t`. Safe to call repeatedly with the same value. */
  setTalking(t: number, talking: boolean): void {
    this.talking = talking;
    this.track(t);
  }

  /** Blinks per minute at time `t`, or null until blinks have counted for `minCoverageMs` of the window. */
  rate(t: number): number | null {
    const from = t - this.windowMs;
    const coverage = this.views.reduce((total, v) => total + Math.max(Math.min(v.end ?? t, t) - Math.max(v.start, from), 0), 0);
    if (coverage < this.minCoverageMs || coverage <= 0) return null;
    const counted = this.blinks.filter((b) => b > from && b <= t && !this.nearConfirm(b)).length;
    return counted / (coverage / MINUTE_MS);
  }

  reset(): void {
    this.blinks = [];
    this.confirms = [];
    this.views = [];
    this.faceInView = false;
    this.talking = false;
  }

  private get counting(): boolean {
    return this.views.at(-1)?.end === null;
  }

  /** Opens or closes the current stretch when whether blinks count changes at `t`. */
  private track(t: number): void {
    const counting = this.faceInView && !this.talking;
    if (counting && !this.counting) {
      const oldest = t - this.windowMs;
      this.views = [...this.views.filter((v) => v.end !== null && v.end > oldest), { start: t, end: null }];
    } else if (!counting && this.counting) {
      this.views = this.views.map((v) => (v.end === null ? { ...v, end: t } : v));
    }
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
