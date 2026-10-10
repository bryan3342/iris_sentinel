import { describe, expect, it } from 'vitest';
import { BlinkSegmenter, MIN_BLINK_MS } from '../../companion/src/detectors/blink';

/** A frame at `ms` milliseconds, as Presage sends it: microsecond timestamps. */
const frame = (ms: number, closed: boolean) => ({ timestamp: ms * 1000, detected: closed });

/** Frames every 40 ms from `fromMs` to `toMs` inclusive, all closed or all open. */
const frames = (fromMs: number, toMs: number, closed: boolean) =>
  Array.from({ length: (toMs - fromMs) / 40 + 1 }, (_, i) => frame(fromMs + i * 40, closed));

describe('BlinkSegmenter', () => {
  it('turns a run of closed frames into one blink, measured to the first open frame', () => {
    const segmenter = new BlinkSegmenter();
    expect(segmenter.add([frame(0, false), ...frames(40, 160, true), frame(200, false)])).toEqual([160]);
  });

  it('joins a blink split across two packets', () => {
    const segmenter = new BlinkSegmenter();
    expect(segmenter.add([frame(0, false), ...frames(40, 120, true)])).toEqual([]);
    expect(segmenter.add([frame(160, true), frame(200, false)])).toEqual([160]);
  });

  it('finds several blinks in one packet', () => {
    const segmenter = new BlinkSegmenter();
    const packet = [...frames(0, 120, true), frame(160, false), ...frames(200, 360, true), frame(400, false)];
    expect(segmenter.add(packet)).toEqual([160, 200]);
  });

  it(`drops flicker shorter than ${MIN_BLINK_MS} ms`, () => {
    const segmenter = new BlinkSegmenter();
    expect(segmenter.add([frame(0, false), frame(40, true), frame(80, false)])).toEqual([]);
  });

  it('drops a closure longer than the extension accepts', () => {
    const segmenter = new BlinkSegmenter();
    expect(segmenter.add([frame(0, true), frame(10_040, false)])).toEqual([]);
  });

  it('ignores frames repeated by an overlapping packet', () => {
    const segmenter = new BlinkSegmenter();
    const packet = [frame(0, false), ...frames(40, 160, true), frame(200, false)];
    expect(segmenter.add(packet)).toEqual([160]);
    expect(segmenter.add(packet)).toEqual([]);
  });

  it('orders frames that arrive out of order within a packet', () => {
    const segmenter = new BlinkSegmenter();
    expect(segmenter.add([frame(200, false), frame(80, true), frame(0, false), frame(40, true), frame(160, true), frame(120, true)])).toEqual([160]);
  });

  it('reads Long timestamps and skips frames without one', () => {
    const segmenter = new BlinkSegmenter();
    const long = (ms: number) => ({ toNumber: () => ms * 1000 });
    const packet = [
      { timestamp: long(0), detected: false },
      { timestamp: long(40), detected: true },
      { detected: false },
      { timestamp: long(200), detected: false },
    ];
    expect(segmenter.add(packet)).toEqual([160]);
  });

  it('reports nothing while a blink is still in progress, or for an empty packet', () => {
    const segmenter = new BlinkSegmenter();
    expect(segmenter.add(frames(0, 80, true))).toEqual([]);
    expect(segmenter.add(null)).toEqual([]);
    expect(segmenter.add([])).toEqual([]);
  });
});
