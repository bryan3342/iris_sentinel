import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACKPAD_BOX } from '@iris/core';
import type { Point2, PointerProvider, PointerSample, Unsubscribe } from '@iris/protocol';
import { FingerPointer } from '../../extension/src/sidepanel/finger-pointer';
import type { TargetList } from '../../extension/src/sidepanel/target-list';

// A 1000 x 800 page on tab 4 with two buttons, far apart.
const PAGE = { width: 1000, height: 800 };
const LIST = {
  tabId: 4, documentToken: 'doc', revision: 1, targetsTruncated: false,
  viewport: { ...PAGE, offsetLeft: 0, offsetTop: 0, scale: 1, scrollX: 0, scrollY: 0 },
  targets: [
    { id: 1, role: 'button', rect: { x: 100, y: 100, width: 100, height: 40 }, risky: false },
    { id: 2, role: 'button', rect: { x: 480, y: 380, width: 60, height: 40 }, risky: false },
  ],
} as unknown as TargetList;

/** A hand in front of the camera, placed by the page point its fingertip maps to through the trackpad box. */
class Hand implements PointerProvider {
  private listener: (sample: PointerSample) => void = () => {};
  async start(): Promise<void> {}
  stop(): void {}
  onSample(listener: (sample: PointerSample) => void): Unsubscribe {
    this.listener = listener;
    return () => { this.listener = () => {}; };
  }
  /** One frame: the fingertip over page point `at` (null: no hand), thumb and finger `gap` palm lengths apart. */
  frame(t: number, at: Point2 | null, gap = 1): void {
    const { min, max } = DEFAULT_TRACKPAD_BOX;
    const tip = at && { x: min.x + (at.x / PAGE.width) * (max.x - min.x), y: min.y + (at.y / PAGE.height) * (max.y - min.y) };
    this.listener({ t, tip, gap: at ? gap : null });
  }
}

function mount() {
  const hand = new Hand();
  const ring: [number, Point2 | null][] = [];
  const aims: (number | null | undefined)[] = [];
  const clicks: [number, number | null][] = [];
  const finger = new FingerPointer({
    provider: hand, list: () => LIST,
    ring: (tabId, at) => void ring.push([tabId, at && { x: Math.round(at.x), y: Math.round(at.y) }]),
    aim: (target) => void aims.push(target),
    pinch: (t, target) => void clicks.push([t, target]),
  });
  finger.start();
  return { hand, ring, aims, clicks, finger };
}

describe('FingerPointer', () => {
  it('moves the ring onto the page like a trackpad, and aims at the button under it or at nothing', () => {
    const { hand, ring, aims } = mount();
    hand.frame(0, { x: 510, y: 400 });
    expect(ring).toEqual([[4, { x: 510, y: 400 }]]);
    expect(aims).toEqual([2]);
    for (let t = 33; t < 1000; t += 33) hand.frame(t, { x: 800, y: 700 }); // far from both buttons
    expect(aims.at(-1)).toBeNull();
  });

  it('holds the aim while thumb and finger come together, and clicks what it held', () => {
    const { hand, aims, clicks } = mount();
    hand.frame(0, { x: 510, y: 400 });
    hand.frame(33, { x: 150, y: 120 }, 0.4); // pinching drags the fingertip toward button 1
    hand.frame(66, { x: 150, y: 120 }, 0.1);
    expect(aims).toEqual([2, 2, 2]);
    expect(clicks).toEqual([[66, 2]]);
  });

  it('hides the ring and hands aiming back to the eyes when the hand leaves, or when stopped', () => {
    const { hand, ring, aims, finger } = mount();
    hand.frame(0, { x: 510, y: 400 });
    hand.frame(33, null);
    hand.frame(66, null);
    expect(ring.at(-1)).toEqual([4, null]);
    expect(aims).toEqual([2, undefined]); // once, not every empty frame
    hand.frame(99, { x: 510, y: 400 });
    finger.end();
    expect(ring.at(-1)).toEqual([4, null]);
    expect(aims.at(-1)).toBeUndefined();
    hand.frame(132, { x: 510, y: 400 });
    expect(aims.at(-1)).toBeUndefined(); // stopped: no longer following the hand
  });
});
