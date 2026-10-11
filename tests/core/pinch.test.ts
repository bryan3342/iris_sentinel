import { describe, expect, it } from 'vitest';
import { PinchDetector } from '@iris/core';

/** Feeds the gap between thumb and index fingertips (in palm lengths, null with no hand) one frame every 33 ms. */
const run = (detector: PinchDetector, gaps: (number | null)[], from = 0) =>
  gaps.map((gap, i) => detector.update(gap, from + i * 33));

describe('PinchDetector', () => {
  it('clicks once when thumb and index finger touch, not again while they stay together', () => {
    const frames = run(new PinchDetector(), [0.9, 0.6, 0.4, 0.2, 0.15, 0.2, 0.3]);
    expect(frames.map((f) => f.pinch)).toEqual([false, false, false, true, false, false, false]);
  });

  it('holds the aim while the fingers come together, so the click lands on what the finger pointed at', () => {
    expect(run(new PinchDetector(), [0.9, 0.45, 0.2, 0.6]).map((f) => f.hold)).toEqual([false, true, true, false]);
  });

  it('clicks again only after the fingers part and a short pause has passed', () => {
    const detector = new PinchDetector();
    expect(run(detector, [0.9, 0.2, 0.6, 0.2]).filter((f) => f.pinch)).toHaveLength(1); // touched again too soon
    expect(run(detector, [0.6, 0.2], 600).map((f) => f.pinch)).toEqual([false, true]);
  });

  it('forgets a pinch in progress when the hand leaves the camera', () => {
    const detector = new PinchDetector();
    run(detector, [0.9, 0.2]);
    expect(run(detector, [null, 0.2], 1000)).toEqual([{ hold: false, pinch: false }, { hold: true, pinch: true }]);
  });
});
