import type { BlinkEvent, FaceProvider, Quality, QualityStatus, Reading, Unsubscribe, VitalsProvider, VitalsSample } from '@iris/protocol';

// A camera-free FaceProvider and VitalsProvider: scripted body signals for
// building and demoing fatigue without Presage, a camera or credits. A
// tiredness source says how tired the simulated user is (0 rested, 1 clearly
// tired); blink rate, pulse, breathing and heart rate variability move between
// resting and tired values with it. A quality source says how good the camera
// view is: blinks and readings stop while the face is lost, breathing alone
// stops while the chest is out of view, and readings warm up again from the
// moment the view is back, like Presage. Jitter comes from a seeded generator,
// so a run repeats exactly. Fake values, but still kept in memory only.

/** How tired the simulated user is at `t` ms after start: 0 rested, 1 clearly tired. */
export type TirednessSource = (t: number) => number;
/** The camera view at `t` ms after start. */
export type QualitySource = (t: number) => Quality;

export interface BodyValues {
  blinksPerMin: number;
  /** Beats per minute. */
  pulse: number;
  /** Breaths per minute. */
  breathing: number;
  /** Heart rate variability (RMSSD), in milliseconds. */
  hrv: number;
}

/** Time from a good view until each reading is stable, in milliseconds. */
export interface WarmUp {
  pulse: number;
  breathing: number;
  hrv: number;
}

export const RESTING: BodyValues = { blinksPerMin: 15, pulse: 68, breathing: 14, hrv: 45 };
// Blinks rise well past the +50% that blink rate swings by with activity alone, so the demo reads as clearly tired.
export const TIRED: BodyValues = { blinksPerMin: 36, pulse: 76, breathing: 19.5, hrv: 25 };
/** What Presage measured on the demo Mac (#24). */
export const PRESAGE_WARM_UP: WarmUp = { pulse: 12_000, breathing: 31_000, hrv: 67_000 };
/** Short warm-ups, so a live demo gets going within seconds. */
export const DEMO_WARM_UP: WarmUp = { pulse: 4_000, breathing: 10_000, hrv: 20_000 };

/** Tiredness that moves in straight lines from 0 through each step's `to`, taking `ms` per step, then holds. */
export function ramp(steps: { to: number; ms: number }[]): TirednessSource {
  return (t) => {
    let from = 0;
    let start = 0;
    for (const step of steps) {
      if (t < start + step.ms) return from + ((step.to - from) * (t - start)) / step.ms;
      from = step.to;
      start += step.ms;
    }
    return from;
  };
}

/** Rested for a minute, then tiring steadily until clearly tired at 135 s. */
export const TIRING_DEMO: TirednessSource = ramp([
  { to: 0, ms: 60_000 },
  { to: 1, ms: 75_000 },
]);

export interface SimulatedBodyOptions {
  tiredness?: TirednessSource;
  quality?: QualitySource;
  warmUp?: WarmUp;
  resting?: BodyValues;
  tired?: BodyValues;
  seed?: number;
}

const TICK_MS = 100;
const VITALS_MS = 1_000; // the companion sends vitals about once a second
const JITTER = { pulse: 2, breathing: 0.8, hrv: 3 };

export class SimulatedBodyProvider implements FaceProvider, VitalsProvider {
  private timer: ReturnType<typeof setInterval> | null = null;
  private random: () => number = () => 0;
  private tick = 0;
  private quality: Quality | null = null;
  /** Start of the current stretch with the face in view; readings warm up from here. */
  private seenSince: number | null = null;
  private nextBlink = 0;
  private readonly blinkListeners = new Set<(blink: BlinkEvent) => void>();
  private readonly qualityListeners = new Set<(status: QualityStatus) => void>();
  private readonly vitalsListeners = new Set<(sample: VitalsSample) => void>();
  private readonly tiredness: TirednessSource;
  private readonly view: QualitySource;
  private readonly warmUp: WarmUp;
  private readonly resting: BodyValues;
  private readonly tired: BodyValues;
  private readonly seed: number;

  constructor({ tiredness = () => 0, quality = () => 'ok', warmUp = PRESAGE_WARM_UP, resting = RESTING, tired = TIRED, seed = 1 }: SimulatedBodyOptions = {}) {
    this.tiredness = tiredness;
    this.view = quality;
    this.warmUp = warmUp;
    this.resting = resting;
    this.tired = tired;
    this.seed = seed;
  }

  async start(): Promise<void> {
    if (this.timer !== null) return;
    this.tick = 0;
    this.quality = null;
    this.seenSince = null;
    let state = this.seed;
    // Park-Miller generator, uniform in -1..1.
    this.random = () => ((state = (state * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    this.nextBlink = this.blinkGap(0);
    this.timer = setInterval(() => this.publish(++this.tick * TICK_MS), TICK_MS);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  onBlink(listener: (blink: BlinkEvent) => void): Unsubscribe {
    this.blinkListeners.add(listener);
    return () => this.blinkListeners.delete(listener);
  }

  onQuality(listener: (status: QualityStatus) => void): Unsubscribe {
    this.qualityListeners.add(listener);
    return () => this.qualityListeners.delete(listener);
  }

  onVitals(listener: (sample: VitalsSample) => void): Unsubscribe {
    this.vitalsListeners.add(listener);
    return () => this.vitalsListeners.delete(listener);
  }

  /** The value of one body signal at `t`, between resting and tired. */
  private value(key: keyof BodyValues, t: number): number {
    const tiredness = Math.min(Math.max(this.tiredness(t), 0), 1);
    return this.resting[key] + (this.tired[key] - this.resting[key]) * tiredness;
  }

  /** Time until the next blink: one blink period at the current rate, give or take 30%. */
  private blinkGap(t: number): number {
    return (60_000 / this.value('blinksPerMin', t)) * (1 + 0.3 * this.random());
  }

  private publish(t: number): void {
    const quality = this.view(t);
    if (quality !== this.quality) {
      this.quality = quality;
      const status: QualityStatus = { t, quality, hint: '' };
      this.qualityListeners.forEach((listener) => listener(status));
    }
    const faceSeen = quality === 'ok' || quality === 'chest-not-visible';
    if (!faceSeen) this.seenSince = null;
    else this.seenSince ??= t;

    if (t >= this.nextBlink) {
      if (faceSeen) {
        const blink: BlinkEvent = { t, durationMs: Math.round(150 + 30 * this.random()) };
        this.blinkListeners.forEach((listener) => listener(blink));
      }
      this.nextBlink = t + this.blinkGap(t);
    }

    if (t % VITALS_MS !== 0) return;
    const reading = (key: 'pulse' | 'breathing' | 'hrv'): Reading | null => {
      if (this.seenSince === null || (key === 'breathing' && quality === 'chest-not-visible')) return null;
      const stable = t - this.seenSince >= this.warmUp[key];
      return { value: this.value(key, t) + JITTER[key] * this.random(), confidence: stable ? 0.9 : 0.3, stable };
    };
    const sample: VitalsSample = { t, pulse: reading('pulse'), breathing: reading('breathing'), hrv: reading('hrv') };
    this.vitalsListeners.forEach((listener) => listener(sample));
  }
}
