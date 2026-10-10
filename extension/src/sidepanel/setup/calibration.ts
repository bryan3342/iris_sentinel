import { fitCalibration, type CalibrationModel, type CalibrationSample } from '@iris/core';
import type { GazeProvider, Point2 } from '@iris/protocol';

// 5-dot calibration: center plus the four corners at a 10% inset.
const DOTS: Point2[] = [
  { x: 0.5, y: 0.5 },
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
];
const SETTLE_MS = 600; // let the eyes land on the dot before sampling
const COLLECT_MS = 1200;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Shows each dot in turn over the whole viewport, records where the eyes were
 * while the user looked at it, and fits a calibration. Samples stay in memory
 * and are discarded once the model is fitted.
 */
export async function runCalibration(provider: GazeProvider): Promise<CalibrationModel> {
  const layer = document.createElement('div');
  layer.className = 'calibration-layer';
  document.body.append(layer);

  const samples: CalibrationSample[] = [];
  let target: Point2 | null = null;
  const unsubscribe = provider.onSample((sample) => {
    if (target && sample.eye) samples.push({ eye: sample.eye, head: sample.head, target });
  });

  try {
    for (const dotTarget of DOTS) {
      const dot = document.createElement('div');
      dot.className = 'calibration-dot';
      dot.style.left = `${dotTarget.x * 100}%`;
      dot.style.top = `${dotTarget.y * 100}%`;
      layer.replaceChildren(dot);
      target = null;
      await wait(SETTLE_MS);
      target = dotTarget;
      await wait(COLLECT_MS);
    }
    return fitCalibration(samples);
  } finally {
    unsubscribe();
    layer.remove();
  }
}
