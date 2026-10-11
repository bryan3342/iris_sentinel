import type { BlinkEvent, FatigueLevel, Quality, QualityStatus, VitalsSample } from '@iris/protocol';
import { Baseline, strain, type TiredDirection } from './baseline';
import { BlinkRateMeter } from './blink-rate';
import { ClickPace } from './click-pace';
import type { ConfirmEvent } from './confirm';
import { combineScore, FatigueLevelTracker, type FatigueLevelOptions } from './fatigue-level';
import { OneEuroFilter } from './smoothing';
import { VitalsWindow } from './vitals-window';

/**
 * The fatigue engine: turns body signals (blink rate, heart rate variability,
 * breathing) and click clues (time to click, landings per click) into a score
 * from 0 to 100 and a level, each clue judged against the user's own baseline.
 *
 * Feed it everything as it arrives, all stamped on one clock, and call
 * `update` about once a second: each update is one sample toward the
 * baselines. Body clues count only while the camera view is trustworthy; once
 * the face has been lost or the view poor for a few seconds, the engine pauses
 * and the score and level hold still. A shorter glitch neither pauses nor
 * throws readings away, since Presage's view status flickers. The talking pause
 * waits for the voice agent.
 */

export const FATIGUE_CLUES = ['blink', 'hrv', 'breathing', 'timeToClick', 'landings'] as const;
export type FatigueClue = (typeof FATIGUE_CLUES)[number];

export interface ClueSettings {
  /** Typical resting value used until the user's own baseline is set, or null for none. */
  fallback: number | null;
  tiredDirection: TiredDirection;
  /** Change toward tired, as a fraction of the baseline, that still counts as noise. */
  ignoreBelow: number;
  /** Change toward tired, as a fraction of the baseline, that counts as fully strained. */
  fullAt: number;
  /** How much the clue counts toward the score, relative to the others. */
  weight: number;
}

export const CLUE_SETTINGS: Record<FatigueClue, ClueSettings> = {
  // 15 a minute is what Presage measured at rest (#24); chance alone swings a minute's count by about 25%.
  blink: { fallback: 15, tiredDirection: 'up', ignoreBelow: 0.25, fullAt: 0.75, weight: 0.25 },
  // The clue most specific to fatigue.
  hrv: { fallback: 40, tiredDirection: 'down', ignoreBelow: 0.1, fullAt: 0.4, weight: 0.3 },
  breathing: { fallback: 14, tiredDirection: 'up', ignoreBelow: 0.1, fullAt: 0.35, weight: 0.15 },
  // Click clues have no typical value; they wait for the user's own.
  timeToClick: { fallback: null, tiredDirection: 'up', ignoreBelow: 0.25, fullAt: 1, weight: 0.15 },
  landings: { fallback: null, tiredDirection: 'up', ignoreBelow: 0.25, fullAt: 1, weight: 0.15 },
};

/** Why the score is not moving: still gathering enough clues, the face is out of view, or the view is too poor to trust. */
export type FatiguePause = 'warming-up' | 'no-face' | 'poor-view';

export interface ClueState {
  /** Blinks or breaths a minute, heart rate variability in ms, time to click in ms, or landings per click. */
  value: number | null;
  baseline: number | null;
  /** True once the baseline is this user's own rather than the fallback. */
  personal: boolean;
  /** 0 (normal) to 1 (clearly tired), or null without a value. */
  strain: number | null;
}

/**
 * The engine's view at one moment. `clues` holds body readings: show it in
 * the side panel, but never log, store or send it. Only `t`, `score` and
 * `level` may leave the side panel.
 */
export interface FatigueState {
  t: number;
  /** Smoothed score, 0 (rested) to 100 (most tired). Holds its last value while paused; null before the first. */
  score: number | null;
  level: FatigueLevel;
  paused: FatiguePause | null;
  clues: Record<FatigueClue, ClueState>;
}

export interface FatigueEngineOptions {
  /** Changes to the settings of individual clues. */
  clues?: Partial<Record<FatigueClue, Partial<ClueSettings>>>;
  level?: FatigueLevelOptions;
  /** Share of the total clue weight that must be available for a score. */
  minCoverage?: number;
  /** Smoothing cutoff for the score in hertz: lower is smoother. 0.016 lags about 10 s. */
  smoothingHz?: number;
  /** How long a lost face or poor view must last before the engine pauses, in milliseconds. */
  viewGraceMs?: number;
}

/** Views that pause the engine. `ok` and `chest-not-visible` (breathing alone stops) do not. */
const PAUSING_VIEWS: Partial<Record<Quality, FatiguePause>> = {
  'no-face': 'no-face',
  'multiple-faces': 'no-face',
  reposition: 'poor-view',
  'too-dark': 'poor-view',
  'too-bright': 'poor-view',
  motion: 'poor-view',
  'camera-adjusting': 'poor-view',
  'low-frame-rate': 'poor-view',
};

export class FatigueEngine {
  private readonly settings: Record<FatigueClue, ClueSettings>;
  private readonly baselines: Record<FatigueClue, Baseline>;
  private readonly blinks = new BlinkRateMeter();
  private readonly pace = new ClickPace();
  private readonly hrv = new VitalsWindow();
  private readonly breathing = new VitalsWindow();
  private readonly levels: FatigueLevelTracker;
  private readonly smoother: OneEuroFilter;
  private readonly minCoverage: number;
  private quality: Quality | null = null;
  /** When the current view began. */
  private qualitySince = 0;
  private readonly viewGraceMs: number;
  private score: number | null = null;

  constructor({ clues = {}, level, minCoverage = 0.3, smoothingHz = 0.016, viewGraceMs = 3_000 }: FatigueEngineOptions = {}) {
    this.viewGraceMs = viewGraceMs;
    this.settings = Object.fromEntries(FATIGUE_CLUES.map((c) => [c, { ...CLUE_SETTINGS[c], ...clues[c] }])) as Record<FatigueClue, ClueSettings>;
    this.baselines = Object.fromEntries(FATIGUE_CLUES.map((c) => [c, new Baseline(this.settings[c])])) as Record<FatigueClue, Baseline>;
    this.levels = new FatigueLevelTracker(level);
    this.smoother = new OneEuroFilter({ minCutoff: smoothingHz, beta: 0 });
    this.minCoverage = minCoverage;
  }

  addVitals(sample: VitalsSample): void {
    if (this.quality === null || PAUSING_VIEWS[this.quality]) return;
    this.hrv.add(sample.t, sample.hrv);
    if (this.quality === 'ok') this.breathing.add(sample.t, sample.breathing);
  }

  addBlink(blink: BlinkEvent): void {
    this.blinks.addBlink(blink);
  }

  /** Every confirm: a double-blink confirm keeps its blink out of the blink rate. */
  addConfirm(event: ConfirmEvent): void {
    this.blinks.addConfirm(event);
  }

  /** Readings are skipped while the view is poor, but kept: they leave the 30 s windows by themselves. */
  setQuality(status: QualityStatus): void {
    if (status.quality !== this.quality) this.qualitySince = status.t;
    this.quality = status.quality;
    this.blinks.setQuality(status);
  }

  /** The aimed target changed. */
  addAim(t: number, target: number | null): void {
    this.pace.aim(t, target);
  }

  /** A safe target was selected after a dwell of `dwellMs`. */
  addClick(t: number, dwellMs: number): void {
    this.pace.click(t, dwellMs);
  }

  update(t: number): FatigueState {
    const bad = this.quality === null ? null : (PAUSING_VIEWS[this.quality] ?? null);
    const viewPause = bad && t - this.qualitySince >= this.viewGraceMs ? bad : null; // a short glitch does not pause
    const current: Record<FatigueClue, number | null> = {
      blink: this.blinks.rate(t),
      hrv: this.hrv.value(t),
      breathing: this.breathing.value(t),
      timeToClick: this.pace.timeToClickMs,
      landings: this.pace.landingsPerClick,
    };
    const clues = {} as Record<FatigueClue, ClueState>;
    for (const clue of FATIGUE_CLUES) {
      const value = viewPause ? null : current[clue];
      const baseline = this.baselines[clue];
      if (value !== null) baseline.add(value);
      clues[clue] = { value, baseline: baseline.value, personal: baseline.personal, strain: strain(value, baseline.value, this.settings[clue]) };
    }

    const strains = Object.fromEntries(FATIGUE_CLUES.map((c) => [c, clues[c].strain]));
    const weights = Object.fromEntries(FATIGUE_CLUES.map((c) => [c, this.settings[c].weight])) as Record<FatigueClue, number>;
    const { score } = viewPause ? { score: null } : combineScore(strains, weights, { minCoverage: this.minCoverage });
    if (score !== null) this.score = this.smoother.filter(score, t);
    const level = this.levels.update(t, score === null ? null : this.score);
    return { t, score: this.score, level, paused: viewPause ?? (score === null ? 'warming-up' : null), clues };
  }

  /** Forgets everything, including the baselines, for a new session. */
  reset(): void {
    this.blinks.reset();
    this.pace.reset();
    this.hrv.clear();
    this.breathing.clear();
    FATIGUE_CLUES.forEach((c) => this.baselines[c].reset());
    this.levels.reset();
    this.smoother.reset();
    this.quality = null;
    this.qualitySince = 0;
    this.score = null;
  }
}
