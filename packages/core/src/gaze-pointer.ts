import type { GazeSample, HeadPose, Point2 } from '@iris/protocol';
import { applyCalibration, type Viewport } from './calibration';
import type { CalibrationStore } from './calibration-store';
import { FixationSmoother } from './fixation';

/**
 * Turns gaze samples into a steady point on the page: calibrated,
 * head-corrected, then fixation-smoothed, in CSS pixels of the page viewport
 * (the browsing tab's, not whatever window runs the tracker). The last point
 * holds while the eyes are closed or the face is lost. The eyes' last few
 * positions are kept so a confirmed target can refine the calibration.
 */

/**
 * Where the page sits inside the area the calibration dots covered, in CSS
 * pixels: the area's size, and the page viewport's top-left corner within it.
 * Calibrated on the page itself, it is the viewport with no offset. Calibrated
 * in screen positions, it is the screen with the window's position, so moving
 * the window or resizing the side panel needs no new calibration.
 */
export interface CalibrationFrame {
  width: number;
  height: number;
  left: number;
  top: number;
}

/** The frame for a calibration made over the page viewport itself. */
export const viewportFrame = ({ width, height }: Viewport): CalibrationFrame => ({ width, height, left: 0, top: 0 });

export interface GazePointerOptions {
  /** Same-fixation radius in pixels: about the size of webcam gaze error on a laptop screen. */
  radius?: number;
}

const RECENT_SAMPLES = 10; // about a third of a second: the eyes' position while the user settles on a target

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export class GazePointer {
  private readonly smoother: FixationSmoother;
  private recent: { eye: Point2; head: HeadPose }[] = [];
  private last: Point2 | null = null;

  constructor(
    private readonly store: CalibrationStore,
    { radius = 70 }: GazePointerOptions = {},
  ) {
    this.smoother = new FixationSmoother({ radius });
  }

  /** The latest smoothed point, or null until a calibrated sample with open eyes has arrived. */
  get point(): Point2 | null {
    return this.last;
  }

  update(sample: GazeSample, frame: CalibrationFrame): Point2 | null {
    if (!sample.eye) return this.last; // hold through closed eyes and a lost face
    this.recent = [...this.recent, { eye: sample.eye, head: sample.head }].slice(-RECENT_SAMPLES);
    const model = this.store.model;
    if (!model) return this.last;
    const p = applyCalibration(model, sample.eye, sample.head, frame);
    this.last = this.smoother.push({ x: p.x * frame.width - frame.left, y: p.y * frame.height - frame.top });
    return this.last;
  }

  /**
   * The user confirmed a target at `pixel`: the eyes' position over the last
   * few samples becomes a calibration sample for it. Returns whether the store
   * accepted it (it rejects confirms far from where the fit says the user looked).
   * `snapped` says gaze itself had snapped to that target, which the store trusts further.
   */
  confirm(pixel: Point2, frame: CalibrationFrame, snapped = false): boolean {
    if (this.recent.length === 0) return false;
    const of = (pick: (s: { eye: Point2; head: HeadPose }) => number) => median(this.recent.map(pick));
    const eye = { x: of((s) => s.eye.x), y: of((s) => s.eye.y) };
    const head: HeadPose = {
      yaw: of((s) => s.head.yaw),
      pitch: of((s) => s.head.pitch),
      eyes: { x: of((s) => s.head.eyes.x), y: of((s) => s.head.eyes.y) },
      eyeSpan: of((s) => s.head.eyeSpan),
    };
    const target = { x: (pixel.x + frame.left) / frame.width, y: (pixel.y + frame.top) / frame.height };
    return this.store.addConfirmed(eye, head, target, frame, snapped);
  }
}
