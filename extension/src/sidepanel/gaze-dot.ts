import { applyCalibration, FixationSmoother, type CalibrationModel } from '@iris/core';
import type { GazeSample } from '@iris/protocol';

// Same-fixation radius: about the size of webcam gaze error on a laptop screen.
const FIXATION_RADIUS_PX = 70;

/** A circle drawn where the user is looking, from calibrated, head-corrected, fixation-smoothed samples. */
export class GazeDot {
  private readonly element = document.createElement('div');
  private readonly smoother = new FixationSmoother({ radius: FIXATION_RADIUS_PX });

  constructor(
    private readonly model: CalibrationModel,
    host: HTMLElement,
  ) {
    this.element.className = 'gaze-dot';
    host.append(this.element);
  }

  update(sample: GazeSample): void {
    if (!sample.eye) return; // hold the last position through blinks
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const p = applyCalibration(this.model, sample.eye, sample.head, viewport);
    const point = this.smoother.push({ x: p.x * window.innerWidth, y: p.y * window.innerHeight });
    this.element.style.transform = `translate(${point.x}px, ${point.y}px)`;
  }

  remove(): void {
    this.element.remove();
  }
}
