import { applyCalibration, CalibrationStore, FixationSmoother, type Viewport } from '@iris/core';
import type { GazeSample, HeadPose, Point2 } from '@iris/protocol';

// Same-fixation radius: about the size of webcam gaze error on a laptop screen.
const FIXATION_RADIUS_PX = 70;
const RECENT_SAMPLES = 10; // about a third of a second: the eyes' position while the user settles on a target

const viewport = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight });

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A circle drawn where the user is looking, from calibrated, head-corrected, fixation-smoothed samples. */
export class GazeDot {
  private readonly element = document.createElement('div');
  private readonly smoother = new FixationSmoother({ radius: FIXATION_RADIUS_PX });
  private recent: { eye: Point2; head: HeadPose }[] = [];

  constructor(
    private readonly store: CalibrationStore,
    host: HTMLElement,
  ) {
    this.element.className = 'gaze-dot';
    host.append(this.element);
  }

  update(sample: GazeSample): void {
    if (!sample.eye) return; // hold the last position through blinks
    this.recent = [...this.recent, { eye: sample.eye, head: sample.head }].slice(-RECENT_SAMPLES);
    const model = this.store.model;
    if (!model) return;
    const p = applyCalibration(model, sample.eye, sample.head, viewport());
    const point = this.smoother.push({ x: p.x * window.innerWidth, y: p.y * window.innerHeight });
    this.element.style.transform = `translate(${point.x}px, ${point.y}px)`;
  }

  /**
   * The user confirmed a target at `pixel`: the eyes' position over the last
   * few samples becomes a calibration sample for it. Returns whether the store
   * accepted it (it rejects confirms far from where the fit says the user looked).
   */
  confirm(pixel: Point2): boolean {
    if (this.recent.length === 0) return false;
    const of = (pick: (s: { eye: Point2; head: HeadPose }) => number) => median(this.recent.map(pick));
    const eye = { x: of((s) => s.eye.x), y: of((s) => s.eye.y) };
    const head: HeadPose = {
      yaw: of((s) => s.head.yaw),
      pitch: of((s) => s.head.pitch),
      eyes: { x: of((s) => s.head.eyes.x), y: of((s) => s.head.eyes.y) },
      eyeSpan: of((s) => s.head.eyeSpan),
    };
    const { width, height } = viewport();
    return this.store.addConfirmed(eye, head, { x: pixel.x / width, y: pixel.y / height }, viewport());
  }

  remove(): void {
    this.element.remove();
  }
}
