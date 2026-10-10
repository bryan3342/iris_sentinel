import type { CalibrationSample } from '@iris/core';
import type { GazeProvider, GazeSample, Point2 } from '@iris/protocol';

const grid = (positions: number[]) => positions.flatMap((y) => positions.map((x) => ({ x, y })));

// Calibration dots near the screen edges (5% inset) so the fit covers the whole
// screen: center plus corners, or a full 3x3 grid.
export const DOT_LAYOUTS: Record<5 | 9, Point2[]> = {
  5: [{ x: 0.5, y: 0.5 }, { x: 0.05, y: 0.05 }, { x: 0.95, y: 0.05 }, { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.95 }],
  9: grid([0.05, 0.5, 0.95]),
};
const SETTLE_MS = 800; // skip the eyes' travel and settling onto the dot
const COLLECT_MS = 1000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Draws one calibration dot at a time, wherever the dots are shown (a playground stage, or the browsing tab). */
export interface DotPresenter {
  /** Shows the dot at a fraction of the area being calibrated, replacing any previous dot. */
  show(dot: Point2): void;
  /** Removes the dots. */
  hide(): void;
}

/** Dots drawn into an element of this page, as the playground does. */
export function elementPresenter(host: HTMLElement): DotPresenter {
  const layer = document.createElement('div');
  layer.className = 'calibration-layer';
  return {
    show(dotTarget) {
      if (!layer.isConnected) host.append(layer);
      const dot = document.createElement('div');
      dot.className = 'calibration-dot';
      dot.style.left = `${dotTarget.x * 100}%`;
      dot.style.top = `${dotTarget.y * 100}%`;
      layer.replaceChildren(dot);
    },
    hide: () => layer.remove(),
  };
}

/** Shows each dot in turn and hands every gaze sample taken while it is shown to `collect`. */
async function presentDots(
  presenter: DotPresenter,
  provider: GazeProvider,
  dots: Point2[],
  collect: (target: Point2, sample: GazeSample) => void,
): Promise<void> {
  let target: Point2 | null = null;
  const unsubscribe = provider.onSample((sample) => {
    if (target) collect(target, sample);
  });
  try {
    for (const dotTarget of dots) {
      presenter.show(dotTarget);
      target = null;
      await wait(SETTLE_MS);
      target = dotTarget;
      await wait(COLLECT_MS);
    }
  } finally {
    unsubscribe();
    presenter.hide();
  }
}

/**
 * Collects where the eyes were at each dot; targets are fractions of the area
 * the presenter draws in. The caller hands the samples to a CalibrationStore.
 */
export async function runCalibration(
  provider: GazeProvider,
  presenter: DotPresenter,
  dotCount: 5 | 9,
): Promise<CalibrationSample[]> {
  const samples: CalibrationSample[] = [];
  await presentDots(presenter, provider, DOT_LAYOUTS[dotCount], (target, s) => {
    if (s.eye) samples.push({ eye: s.eye, head: s.head, target });
  });
  return samples;
}
