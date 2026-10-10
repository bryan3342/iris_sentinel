import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FromCompanion } from '@iris/protocol';
import { type PresageEvents, type PresageRun, PresageSensing } from '../../companion/src/presage/sensing';

const FAKE_KEY = 'fake-presage-key-for-tests';

/** Stands in for a Presage session: records start and stop, and lets the test fire its events. */
class FakeRun implements PresageRun {
  started = false;
  stopped = false;
  constructor(readonly key: string, readonly events: PresageEvents) {}
  start(): void {
    this.started = true;
  }
  async stop(): Promise<void> {
    this.stopped = true;
  }
}

function setup({ key = FAKE_KEY as string | null } = {}) {
  const runs: FakeRun[] = [];
  const sent: FromCompanion[] = [];
  const sensing = new PresageSensing({
    readKey: async () => key,
    createSession: (apiKey, events) => {
      const run = new FakeRun(apiKey, events);
      runs.push(run);
      return run;
    },
  });
  const start = async () => {
    sensing.start((message) => sent.push(message));
    await vi.advanceTimersByTimeAsync(0);
  };
  return { sensing, runs, sent, start, run: () => runs.at(-1)! };
}

const pulsePacket = { cardio: { pulseRate: [{ value: 72, confidence: 90, stable: true, timestamp: 1 }] } };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('PresageSensing', () => {
  it('reports a missing key without starting Presage', async () => {
    const { start, sent, runs } = setup({ key: null });
    await start();
    expect(sent).toEqual([
      { type: 'status', state: 'starting' },
      { type: 'status', state: 'key-missing' },
    ]);
    expect(runs).toEqual([]);
  });

  it('starts Presage with the stored key and reports when it is measuring', async () => {
    const { start, sent, run } = setup();
    await start();
    expect(run().key).toBe(FAKE_KEY);
    expect(run().started).toBe(true);
    run().events.onRunning();
    expect(sent).toEqual([
      { type: 'status', state: 'starting' },
      { type: 'status', state: 'running' },
    ]);
  });

  it('sends camera quality only when it changes, with the hint cut to 200 characters', async () => {
    const { start, sent, run } = setup();
    await start();
    run().events.onQuality('kTooDark', 'x'.repeat(300));
    run().events.onQuality('kTooDark', 'x'.repeat(300));
    run().events.onQuality('kOk', '');
    const quality = sent.filter((m) => m.type === 'quality');
    expect(quality).toEqual([
      { type: 'quality', quality: 'too-dark', hint: 'x'.repeat(200) },
      { type: 'quality', quality: 'ok', hint: '' },
    ]);
  });

  it('sends vitals once a second, only when something new arrived', async () => {
    const { start, sent, run } = setup();
    await start();
    run().events.onMetrics(pulsePacket);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent.filter((m) => m.type === 'vitals')).toEqual([
      { type: 'vitals', pulse: { value: 72, confidence: 0.9, stable: true }, breathing: null, hrv: null },
    ]);
  });

  it('sends each blink as soon as it ends, rounded to whole milliseconds', async () => {
    const { start, sent, run } = setup();
    await start();
    const us = (ms: number) => Math.round(ms * 1000);
    run().events.onMetrics({
      face: {
        blinking: [
          { timestamp: us(0), detected: false },
          { timestamp: us(33.3), detected: true },
          { timestamp: us(166.7), detected: false },
        ],
      },
    });
    expect(sent.filter((m) => m.type === 'blink')).toEqual([{ type: 'blink', durationMs: 133 }]);
  });

  it('reports a Presage error as a status and releases the camera', async () => {
    const { start, sent, run } = setup();
    await start();
    run().events.onError('kCreditExhausted');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.at(-1)).toEqual({ type: 'status', state: 'credits-exhausted' });
    expect(run().stopped).toBe(true);
  });

  it('reports camera-unavailable and releases Presage when no camera frame arrives within 15 seconds', async () => {
    const { start, sent, run } = setup();
    await start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(sent.at(-1)).toEqual({ type: 'status', state: 'camera-unavailable' });
    expect(run().stopped).toBe(true);
  });

  it('keeps measuring when a camera frame arrives in time, even a poorly framed one', async () => {
    const { start, sent, run } = setup();
    await start();
    run().events.onQuality('kNoFaceFound', 'No face found.');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent.some((m) => m.type === 'status' && m.state === 'camera-unavailable')).toBe(false);
    expect(run().stopped).toBe(false);
  });

  it('stops Presage and sends nothing more after stop', async () => {
    const { sensing, start, sent, run } = setup();
    await start();
    await sensing.stop();
    const before = sent.length;
    run().events.onRunning();
    run().events.onMetrics(pulsePacket);
    await vi.advanceTimersByTimeAsync(2000);
    expect(run().stopped).toBe(true);
    expect(sent).toHaveLength(before);
  });

  it('keeps one Presage session when started twice, and starts a new one after a stop', async () => {
    const { sensing, start, runs } = setup();
    await start();
    await start();
    expect(runs).toHaveLength(1);
    await sensing.stop();
    await start();
    expect(runs).toHaveLength(2);
  });

  it('reports error, and can start again, when the key cannot be read', async () => {
    const sent: FromCompanion[] = [];
    let fail = true;
    const sensing = new PresageSensing({
      readKey: async () => {
        if (fail) throw new Error('keychain locked');
        return null;
      },
      createSession: () => {
        throw new Error('unused');
      },
    });
    sensing.start((m) => sent.push(m));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.at(-1)).toEqual({ type: 'status', state: 'error' });
    fail = false;
    sensing.start((m) => sent.push(m));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.at(-1)).toEqual({ type: 'status', state: 'key-missing' });
  });
});
