import { quantile } from './stats';

/**
 * The two click clues for fatigue, measured around each click so that reading
 * a page (which moves the aim across many targets) never counts as shakiness:
 *
 * - Time to click: from the first time the aim landed on the clicked target
 *   until its final dwell began, plus a fixed reference dwell. Leaving the
 *   real dwell time out means slowing the dwell for a tired user can never
 *   make their score worse.
 * - Landings per click: how many times the aim landed on the target before
 *   the click stuck. A steady click is 1; slipping off and back twice is 3.
 *
 * Leaving the target and coming back quickly is a slip within the same
 * approach; coming back later starts a new approach. Both clues compare with
 * the user's own baseline, so the absolute values only need to be consistent.
 */

export interface ClickPaceOptions {
  /** Leaving the target and coming back within this long is a slip, not a new approach, in milliseconds. */
  slipMs?: number;
  /** Clicks needed before either clue is reported. */
  minClicks?: number;
  /** How many of the most recent clicks the clues are taken over. */
  recentClicks?: number;
  /** Dwell that time to click is expressed against, in milliseconds. */
  referenceDwellMs?: number;
}

interface AimChange {
  t: number;
  target: number | null;
}

interface ClickSample {
  timeToClickMs: number;
  landings: number;
}

const HISTORY_MS = 60_000;

export class ClickPace {
  private readonly slipMs: number;
  private readonly minClicks: number;
  private readonly recentClicks: number;
  private readonly referenceDwellMs: number;
  private aims: AimChange[] = [];
  private clicks: ClickSample[] = [];

  constructor({ slipMs = 2_000, minClicks = 3, recentClicks = 5, referenceDwellMs = 1_000 }: ClickPaceOptions = {}) {
    this.slipMs = slipMs;
    this.minClicks = minClicks;
    this.recentClicks = recentClicks;
    this.referenceDwellMs = referenceDwellMs;
  }

  /** Records that the aimed target became `target` (null for none) at time `t`. Repeats of the same target are ignored. */
  aim(t: number, target: number | null): void {
    if (this.aims.at(-1)?.target === target) return;
    this.aims = [...this.aims.filter((a) => a.t >= t - HISTORY_MS), { t, target }];
  }

  /**
   * Records that the aimed target was selected at time `t` after a dwell of
   * `dwellMs`. Report only safe targets: a risky one waits for a double blink,
   * which would read as a slow click.
   */
  click(t: number, dwellMs: number): void {
    const last = this.aims.length - 1;
    const target = this.aims[last]?.target ?? null;
    if (target === null) return; // nothing aimed, for example a stand-in confirm

    // Walk back through earlier visits to the same target while each gap away was a quick slip.
    let first = last;
    let landings = 1;
    for (let i = last - 1; i >= 0; i--) {
      if (this.aims[i]!.target !== target) continue;
      const away = this.aims[first]!.t - this.aims[i + 1]!.t; // from leaving the target to landing on it again
      if (away > this.slipMs) break;
      first = i;
      landings += 1;
    }
    const settleMs = Math.max(t - dwellMs - this.aims[first]!.t, 0);
    this.clicks = [...this.clicks, { timeToClickMs: settleMs + this.referenceDwellMs, landings }].slice(-this.recentClicks);
  }

  /** Median time to click over the recent clicks, in milliseconds, or null before `minClicks`. */
  get timeToClickMs(): number | null {
    if (this.clicks.length < this.minClicks) return null;
    return quantile(this.clicks.map((c) => c.timeToClickMs), 0.5);
  }

  /** Mean landings per click over the recent clicks, or null before `minClicks`. */
  get landingsPerClick(): number | null {
    if (this.clicks.length < this.minClicks) return null;
    return this.clicks.reduce((total, c) => total + c.landings, 0) / this.clicks.length;
  }

  reset(): void {
    this.aims = [];
    this.clicks = [];
  }
}
