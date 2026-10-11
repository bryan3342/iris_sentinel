import { expect, it } from 'vitest';
import type { GazeProvider, GazeSample } from '@iris/protocol';
import { faceSteady } from '../../extension/src/sidepanel/setup/calibration';

const HEAD = { yaw: 0, pitch: 0, eyes: { x: 0.5, y: 0.5 }, eyeSpan: 0.2 };

/** A camera stand-in fed by hand, one sample at a time. */
function camera() {
  const listeners = new Set<(sample: GazeSample) => void>();
  const provider: GazeProvider = {
    start: async () => {}, stop: () => {},
    onSample: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  let t = 0;
  const frame = (seen: boolean) => listeners.forEach((l) => l({ t: (t += 33), eye: seen ? { x: 0, y: 0 } : null, head: HEAD, blink: { left: 0, right: 0 } }));
  return { provider, frame, listeners };
}

it('waits for an unbroken stretch of a tracked face, starting over when the face is lost, then stops listening', async () => {
  const { provider, frame, listeners } = camera();
  let steady = false;
  const waiting = faceSteady(provider, 3).then(() => { steady = true; });
  frame(true); frame(true); frame(false); // lost before the stretch ended
  frame(true); frame(true);
  await Promise.resolve();
  expect(steady).toBe(false);
  frame(true);
  await waiting;
  expect(steady).toBe(true);
  expect(listeners.size).toBe(0);
});
