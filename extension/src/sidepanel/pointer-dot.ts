import { PointFilter, trackpadToScreen } from '@iris/core';
import type { PointerSample } from '@iris/protocol';

/**
 * A blue circle that follows the user's index finger through the trackpad map.
 * Hand pointing is continuous, unlike gaze with its jumps, so a One Euro filter
 * smooths it: steady while the hand rests, quick to follow when it moves.
 */
export class PointerDot {
  private readonly element = document.createElement('div');
  private readonly filter = new PointFilter({ minCutoff: 1, beta: 0.02 });

  constructor(host: HTMLElement) {
    this.element.className = 'pointer-dot';
    this.element.hidden = true;
    host.append(this.element);
  }

  update(sample: PointerSample): void {
    if (!sample.tip) {
      this.element.hidden = true; // no hand in view: nothing to point with
      this.filter.reset();
      return;
    }
    const p = trackpadToScreen(sample.tip);
    const point = this.filter.filter({ x: p.x * window.innerWidth, y: p.y * window.innerHeight }, sample.t);
    this.element.hidden = false;
    this.element.style.transform = `translate(${point.x}px, ${point.y}px)`;
  }

  remove(): void {
    this.element.remove();
  }
}
