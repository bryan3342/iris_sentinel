import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACKPAD_BOX, trackpadToScreen } from '@iris/core';

const expectPoint = (actual: { x: number; y: number }, x: number, y: number) => {
  expect(actual.x).toBeCloseTo(x);
  expect(actual.y).toBeCloseTo(y);
};

describe('trackpadToScreen', () => {
  const box = { min: { x: 0.2, y: 0.3 }, max: { x: 0.6, y: 0.7 } };

  it('maps the box corners to the viewport corners', () => {
    expectPoint(trackpadToScreen(box.min, box), 0, 0);
    expectPoint(trackpadToScreen(box.max, box), 1, 1);
    expectPoint(trackpadToScreen({ x: 0.4, y: 0.5 }, box), 0.5, 0.5);
  });

  it('sticks to the nearest edge outside the box', () => {
    expectPoint(trackpadToScreen({ x: 0.05, y: 0.9 }, box), 0, 1);
  });

  it('uses a box around the middle of the view by default', () => {
    const center = {
      x: (DEFAULT_TRACKPAD_BOX.min.x + DEFAULT_TRACKPAD_BOX.max.x) / 2,
      y: (DEFAULT_TRACKPAD_BOX.min.y + DEFAULT_TRACKPAD_BOX.max.y) / 2,
    };
    expectPoint(trackpadToScreen(center), 0.5, 0.5);
  });
});
