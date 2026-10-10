import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCalibration, CalibrationStore, FixationSmoother, snapToTarget, type SnapTarget } from '@iris/core';
import type { GazeSample, Point2 } from '@iris/protocol';
import { DOT_LAYOUTS } from '../../extension/src/sidepanel/setup/calibration';
import { eyeFor, scripted, SimulatedGazeProvider } from '../../extension/src/providers/simulated/gaze';

const VIEWPORT = { width: 1440, height: 900 };

function record(provider: SimulatedGazeProvider): GazeSample[] {
  const samples: GazeSample[] = [];
  provider.onSample((s) => samples.push(s));
  return samples;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SimulatedGazeProvider', () => {
  it('publishes the scripted point as an eye feature about 30 times a second', async () => {
    const provider = new SimulatedGazeProvider(scripted([{ at: { x: 0.2, y: 0.7 }, ms: 1000 }]), { noise: 0 });
    const samples = record(provider);
    await provider.start();
    vi.advanceTimersByTime(1000);
    expect(samples).toHaveLength(30);
    expect(samples[0]!.eye).toEqual(eyeFor({ x: 0.2, y: 0.7 }));
    expect(samples.map((s) => s.t)).toEqual([...samples.map((s) => s.t)].sort((a, b) => a - b));
  });

  it('moves through the script and holds the last step', async () => {
    const provider = new SimulatedGazeProvider(
      scripted([
        { at: { x: 0.5, y: 0.5 }, ms: 200 },
        { at: null, ms: 200 },
        { at: { x: 0.9, y: 0.1 }, ms: 200 },
      ]),
      { noise: 0 },
    );
    const samples = record(provider);
    await provider.start();
    vi.advanceTimersByTime(1000);
    const at = (ms: number) => samples.find((s) => s.t >= ms)!.eye;
    expect(at(100)).toEqual(eyeFor({ x: 0.5, y: 0.5 }));
    expect(at(300)).toBeNull(); // eyes closed or face out of view
    expect(at(500)).toEqual(eyeFor({ x: 0.9, y: 0.1 }));
    expect(at(900)).toEqual(eyeFor({ x: 0.9, y: 0.1 }));
  });

  it('adds the same bounded jitter on every run with the same seed', async () => {
    const run = async () => {
      const provider = new SimulatedGazeProvider(scripted([{ at: { x: 0.5, y: 0.5 }, ms: 1000 }]), { noise: 0.02, seed: 7 });
      const samples = record(provider);
      await provider.start();
      vi.advanceTimersByTime(500);
      provider.stop();
      return samples.map((s) => s.eye!);
    };
    const first = await run();
    expect(await run()).toEqual(first);
    const center = eyeFor({ x: 0.5, y: 0.5 });
    expect(first.some((e) => e.x !== center.x)).toBe(true);
    for (const e of first) expect(Math.hypot(e.x - center.x, e.y - center.y)).toBeLessThanOrEqual(0.02 * Math.SQRT2);
  });

  it('stops publishing after stop()', async () => {
    const provider = new SimulatedGazeProvider(scripted([{ at: { x: 0.5, y: 0.5 }, ms: 1000 }]));
    const samples = record(provider);
    await provider.start();
    vi.advanceTimersByTime(200);
    provider.stop();
    const count = samples.length;
    vi.advanceTimersByTime(500);
    expect(samples).toHaveLength(count);
  });
});

describe('simulated gaze through calibration and smoothing', () => {
  /** Calibrates like the dot routine: each dot is looked at for a second, the first 800 ms are settling. */
  async function calibrate(store: CalibrationStore): Promise<void> {
    const steps = DOT_LAYOUTS[9].map((at) => ({ at, ms: 1800 }));
    const provider = new SimulatedGazeProvider(scripted(steps), { noise: 0.02 });
    const samples = record(provider);
    await provider.start();
    vi.advanceTimersByTime(steps.length * 1800);
    provider.stop();
    const dotAt = (t: number) => DOT_LAYOUTS[9][Math.floor(t / 1800)]!;
    const collected = samples.filter((s) => s.eye && s.t % 1800 >= 800);
    store.setDots(collected.map((s) => ({ eye: s.eye!, head: s.head, target: dotAt(s.t) })), VIEWPORT);
  }

  it('lands a jittery gaze on the point the simulated user looks at', async () => {
    const store = new CalibrationStore();
    await calibrate(store);
    const target: Point2 = { x: 0.3, y: 0.6 };
    const provider = new SimulatedGazeProvider(scripted([{ at: target, ms: 1000 }]), { noise: 0.02, seed: 3 });
    const smoother = new FixationSmoother({ radius: 70 });
    let point: Point2 = { x: 0, y: 0 };
    provider.onSample((s) => {
      const p = applyCalibration(store.model!, s.eye!, s.head, VIEWPORT);
      point = smoother.push({ x: p.x * VIEWPORT.width, y: p.y * VIEWPORT.height });
    });
    await provider.start();
    vi.advanceTimersByTime(1000);
    expect(Math.hypot(point.x - target.x * VIEWPORT.width, point.y - target.y * VIEWPORT.height)).toBeLessThan(20);
  });

  it('settles on the page target the simulated user looks at and holds it', async () => {
    const store = new CalibrationStore();
    await calibrate(store);
    // A row of links 140 px wide with 20 px gaps, like a navigation bar.
    const targets: SnapTarget[] = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, rect: { x: 100 + i * 160, y: 300, width: 140, height: 32 } }));
    const center = (t: SnapTarget): Point2 => ({ x: (t.rect.x + t.rect.width / 2) / VIEWPORT.width, y: (t.rect.y + t.rect.height / 2) / VIEWPORT.height });
    const provider = new SimulatedGazeProvider(
      scripted([
        { at: center(targets[2]!), ms: 1000 },
        { at: center(targets[5]!), ms: 1000 },
      ]),
      { noise: 0.02, seed: 5 },
    );
    const smoother = new FixationSmoother({ radius: 70 });
    let aim: number | null = null;
    const aims: { t: number; aim: number | null }[] = [];
    provider.onSample((s) => {
      const p = applyCalibration(store.model!, s.eye!, s.head, VIEWPORT);
      const point = smoother.push({ x: p.x * VIEWPORT.width, y: p.y * VIEWPORT.height });
      aim = snapToTarget(point, targets, aim, { maxDistance: 80, hysteresis: 20 });
      aims.push({ t: s.t, aim });
    });
    await provider.start();
    vi.advanceTimersByTime(2000);
    // After a short settle, each look holds one steady aim on the intended target.
    expect(new Set(aims.filter((a) => a.t >= 300 && a.t < 1000).map((a) => a.aim))).toEqual(new Set([3]));
    expect(new Set(aims.filter((a) => a.t >= 1300).map((a) => a.aim))).toEqual(new Set([6]));
  });
});
