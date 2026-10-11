import type { CalibrationSample } from '@iris/core';
import type { GazeProvider, GazeSample, HeadPose, Point2, Unsubscribe } from '@iris/protocol';

// A camera-free GazeProvider. It drives "Point with the mouse" in the side
// panel, where the look source is the mouse pointer, and scripted looks in
// tests. A look source says where the user is looking (a fraction of the screen,
// or null while the eyes are closed or the face is out of view); the provider turns that into
// eye samples through a fixed eye model, with optional webcam-like jitter from a
// seeded generator so a run repeats exactly. The head stays still and level, and
// the eyes always read open, so a null look never counts as a double blink.

/** Where the simulated user is looking at `t` ms after start, as a fraction of the screen. */
export type LookSource = (t: number) => Point2 | null;

export interface SimulatedGazeOptions {
  /** Max jitter per axis, in eye-feature units. Real webcam noise is roughly 0.02. */
  noise?: number;
  seed?: number;
}

const PERIOD_MS = 33; // about 30 samples a second, like a webcam
export const SIMULATED_HEAD: HeadPose = { yaw: 0, pitch: 0, eyes: { x: 0.5, y: 0.5 }, eyeSpan: 0.2 };

/** The simulated eye: a fixed linear map from screen point to eye feature, which calibration learns. */
export function eyeFor(point: Point2): Point2 {
  return { x: (point.x - 0.5) * 0.8, y: (point.y - 0.5) * 0.6 };
}

/** A perfect 9-dot calibration for the simulated eye, so a simulated user aims without running the dots. */
export function simulatedCalibration(): CalibrationSample[] {
  const dots = [0.05, 0.5, 0.95].flatMap((y) => [0.05, 0.5, 0.95].map((x) => ({ x, y })));
  return dots.flatMap((target) => [0, 1, 2].map(() => ({ eye: eyeFor(target), head: SIMULATED_HEAD, target })));
}

/** A look source that plays `steps` in order and holds the last one. */
export function scripted(steps: { at: Point2 | null; ms: number }[]): LookSource {
  return (t) => {
    let end = 0;
    for (const step of steps) {
      end += step.ms;
      if (t < end) return step.at;
    }
    return steps.at(-1)?.at ?? null;
  };
}

export class SimulatedGazeProvider implements GazeProvider {
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;
  private random: () => number = () => 0;
  private readonly listeners = new Set<(sample: GazeSample) => void>();
  private readonly noise: number;
  private readonly seed: number;

  constructor(
    private readonly look: LookSource,
    { noise = 0.02, seed = 1 }: SimulatedGazeOptions = {},
  ) {
    this.noise = noise;
    this.seed = seed;
  }

  async start(): Promise<void> {
    if (this.timer !== null) return;
    this.tick = 0;
    let state = this.seed;
    // Park-Miller generator, uniform in -1..1.
    this.random = () => ((state = (state * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    this.timer = setInterval(() => this.publish(++this.tick * PERIOD_MS), PERIOD_MS);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  onSample(listener: (sample: GazeSample) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(t: number): void {
    const at = this.look(t);
    let eye: Point2 | null = null;
    if (at) {
      const clean = eyeFor(at);
      eye = { x: clean.x + this.random() * this.noise, y: clean.y + this.random() * this.noise };
    }
    const sample: GazeSample = { t, eye, head: SIMULATED_HEAD, blink: { left: 0, right: 0 } };
    this.listeners.forEach((listener) => listener(sample));
  }
}
