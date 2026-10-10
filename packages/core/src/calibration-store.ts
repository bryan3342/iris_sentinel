import type { HeadPose, Point2 } from '@iris/protocol';
import { applyCalibration, fitCalibration, type CalibrationModel, type CalibrationSample, type Viewport } from './calibration';

/**
 * Keeps the raw calibration samples rather than fitted weights and refits on
 * every change. Calibration dots are the anchor; every confirmed target during
 * use adds a sample taken in whatever head position the user was in, which is
 * the coverage a still-head calibration never has. A confirm only counts when
 * the current fit already puts the gaze near that target, so a wrong selection
 * cannot drag the map away. Samples are a few numbers each, never images.
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
}

const MIN_TARGETS = 3;
const targetKey = (s: CalibrationSample) => `${s.target.x},${s.target.y}`;

export class CalibrationStore {
  private dots: StoredSample[] = [];
  private confirmed: StoredSample[] = [];
  private fitted: CalibrationModel | null = null;
  private readonly tolerance: number;
  private readonly maxConfirmed: number;

  constructor(samples: StoredSample[] = [], viewport?: Viewport, { tolerance = 0.15, maxConfirmed = 60 }: CalibrationStoreOptions = {}) {
    this.tolerance = tolerance;
    this.maxConfirmed = maxConfirmed;
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
   * tolerance, in which case the sample is dropped. Before any fit exists,
   * every confirm is accepted: that is how a run with no dots gets started.
   */
  addConfirmed(eye: Point2, head: HeadPose, target: Point2, viewport: Viewport): boolean {
    if (this.fitted) {
      const p = applyCalibration(this.fitted, eye, head, viewport);
      if (Math.hypot(p.x - target.x, p.y - target.y) > this.tolerance) return false;
    }
    const sample: StoredSample = { eye, head, target, source: 'confirm' };
    this.confirmed = [...this.confirmed, sample].slice(-this.maxConfirmed);
    this.refit(viewport);
    return true;
  }

  private refit(viewport: Viewport): void {
    const all = this.samples;
    const targets = new Set(all.map(targetKey)).size;
    this.fitted = targets >= MIN_TARGETS ? fitCalibration(all, viewport) : null;
  }
}
