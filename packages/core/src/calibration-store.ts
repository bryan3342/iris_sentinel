import type { EyeReading, HeadPose, Point2 } from '@iris/protocol';
import { applyCalibration, fitCalibration, type CalibrationModel, type CalibrationSample, type Viewport } from './calibration';

/**
 * Keeps the raw calibration samples rather than fitted weights and refits on
 * every change. Calibration dots are the anchor; every confirmed target during
 * use adds a sample taken in whatever head position the user was in, which is
 * the coverage a still-head calibration never has. A confirm only counts when
 * the current fit already puts the gaze near that target, so a wrong selection
 * cannot drag the map away. Samples are a few numbers each, never images.
 *
 * A dot contributes dozens of samples and a confirm only one, so each confirm
 * counts as several dot samples, and recent confirms count most: the map
 * follows the user's current posture instead of averaging over the session.
 */

export type SampleSource = 'dot' | 'confirm';

export interface StoredSample extends CalibrationSample {
  source: SampleSource;
}

export interface CalibrationStoreOptions {
  /** Max distance (viewport fraction) between the fitted point and a confirmed target for it to count. */
  tolerance?: number;
  /** Most recent confirmed samples kept; older ones fall away as the user keeps going. */
  maxConfirmed?: number;
  /**
   * Looser limit for a confirm of the target gaze itself snapped to. The user looked there on
   * purpose, so a fit that has drifted further than `tolerance` can still be pulled back.
   */
  snappedTolerance?: number;
}

const MIN_TARGETS = 3;
const CONFIRM_WEIGHT = 10; // the newest confirm counts as ten dot samples
const CONFIRM_HALF_LIFE = 10; // and counts half as much ten confirms later
const targetKey = (s: CalibrationSample) => `${s.target.x},${s.target.y}`;

export class CalibrationStore {
  private dots: StoredSample[] = [];
  private confirmed: StoredSample[] = [];
  private fitted: CalibrationModel | null = null;
  private readonly tolerance: number;
  private readonly maxConfirmed: number;
  private readonly snappedTolerance: number;

  constructor(samples: StoredSample[] = [], viewport?: Viewport, { tolerance = 0.15, maxConfirmed = 60, snappedTolerance = 0.35 }: CalibrationStoreOptions = {}) {
    this.tolerance = tolerance;
    this.maxConfirmed = maxConfirmed;
    this.snappedTolerance = snappedTolerance;
    this.dots = samples.filter((s) => s.source === 'dot');
    this.confirmed = samples.filter((s) => s.source === 'confirm').slice(-maxConfirmed);
    if (viewport) this.refit(viewport);
  }

  /** Current fit, or null until at least three distinct targets have been seen. */
  get model(): CalibrationModel | null {
    return this.fitted;
  }

  /** Every sample behind the fit, for saving. */
  get samples(): StoredSample[] {
    return [...this.dots, ...this.confirmed];
  }

  /** Replaces the calibration dots (a fresh run of the dot routine). Confirms are kept. */
  setDots(samples: CalibrationSample[], viewport: Viewport): void {
    this.dots = samples.map((s): StoredSample => ({ ...s, source: 'dot' }));
    this.refit(viewport);
  }

  /**
   * Records that the user confirmed `target` while their eyes were at `eye`.
   * Returns false when the fit disagrees with the target by more than the
   * tolerance (the looser one when gaze had `snapped` to that target), in which
   * case the sample is dropped. Before any fit exists, every confirm is
   * accepted: that is how a run with no dots gets started.
   */
  addConfirmed(eye: EyeReading, head: HeadPose, target: Point2, viewport: Viewport, snapped = false): boolean {
    if (this.fitted) {
      const p = applyCalibration(this.fitted, eye, head, viewport);
      if (Math.hypot(p.x - target.x, p.y - target.y) > (snapped ? this.snappedTolerance : this.tolerance)) return false;
    }
    const sample: StoredSample = { eye, head, target, source: 'confirm' };
    this.confirmed = [...this.confirmed, sample].slice(-this.maxConfirmed);
    this.refit(viewport);
    return true;
  }

  private refit(viewport: Viewport): void {
    const newest = this.confirmed.length - 1;
    const all = [
      ...this.dots,
      ...this.confirmed.map((s, i) => ({ ...s, weight: CONFIRM_WEIGHT * 0.5 ** ((newest - i) / CONFIRM_HALF_LIFE) })),
    ];
    const targets = new Set(all.map(targetKey)).size;
    this.fitted = targets >= MIN_TARGETS ? fitCalibration(all, viewport) : null;
  }
}
