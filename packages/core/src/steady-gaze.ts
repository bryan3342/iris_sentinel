import type { GazeSample } from '@iris/protocol';
import { OneEuroFilter } from './smoothing';

/**
 * Steadies gaze samples at the source, before calibration, aiming or checks read them. Every
 * reading (eye position, lid, head turn, tilt, position and size) goes through a median of its
 * last three values, which drops a single-frame spike such as a flicker of light, and then a One
 * Euro filter: heavy smoothing while it is still, little while it moves on purpose. Head readings
 * need it most: a wobble of one degree in head turn moves the corrected gaze point about 40 px.
 * A trust score (from the light on the face) lowers the resting cutoff, so poor light is smoothed
 * harder. Blink closures pass through untouched, so double blinks keep their timing.
 */

const MIN_CUTOFF_HZ = 0.5;
const BETA = 0.6; // per typical movement unit per second; scaled per reading below
const GAP_MS = 500; // after a gap this long (face lost) the filters start again
// How far each reading moves for a deliberate change: half the screen for the eyes, about 6 degrees of head turn.
const UNITS = { eye: 0.2, lid: 0.05, angle: 0.1, position: 0.05, span: 0.02 };

class Channel {
  private recent: number[] = [];
  private readonly smooth: OneEuroFilter;

  constructor(unit: number) {
    this.smooth = new OneEuroFilter({ minCutoff: MIN_CUTOFF_HZ, beta: BETA / unit });
  }

  push(value: number, t: number, cutoffScale: number): number {
    this.recent = [...this.recent, value].slice(-3);
    const sorted = [...this.recent].sort((a, b) => a - b);
    const middle = sorted.length === 2 ? (sorted[0]! + sorted[1]!) / 2 : sorted[Math.floor(sorted.length / 2)]!;
    return this.smooth.filter(middle, t, cutoffScale);
  }

  reset(): void {
    this.recent = [];
    this.smooth.reset();
  }
}

export class SteadyGaze {
  private readonly channels = {
    eyeX: new Channel(UNITS.eye), eyeY: new Channel(UNITS.eye), lid: new Channel(UNITS.lid),
    yaw: new Channel(UNITS.angle), pitch: new Channel(UNITS.angle),
    headX: new Channel(UNITS.position), headY: new Channel(UNITS.position), span: new Channel(UNITS.span),
  };
  private lastT: number | null = null;

  /** The steadied sample. `trust` is 0..1: 1 in good light, lower in light that makes readings noisy. */
  filter(sample: GazeSample, trust = 1): GazeSample {
    const { t } = sample;
    if (this.lastT !== null && t - this.lastT > GAP_MS) Object.values(this.channels).forEach((c) => c.reset());
    this.lastT = t;
    const scale = 0.3 + 0.7 * Math.max(0, Math.min(1, trust));
    const c = this.channels;
    const at = (channel: Channel, value: number) => channel.push(value, t, scale);
    const { head, eye } = sample;
    const steadyHead = {
      yaw: at(c.yaw, head.yaw), pitch: at(c.pitch, head.pitch),
      eyes: { x: at(c.headX, head.eyes.x), y: at(c.headY, head.eyes.y) }, eyeSpan: at(c.span, head.eyeSpan),
    };
    const steadyEye = eye && {
      x: at(c.eyeX, eye.x), y: at(c.eyeY, eye.y),
      ...(eye.lid === undefined ? {} : { lid: at(c.lid, eye.lid) }),
    };
    return { ...sample, eye: steadyEye, head: steadyHead };
  }
}

export type LightAdvice = 'dim' | 'backlit' | 'bright' | null;

/** Brightness of the face and of the whole camera picture, 0..255, and the face's contrast (standard deviation). */
export interface LightLevels {
  face: number;
  contrast: number;
  scene: number;
}

const ramp = (v: number, from: number, to: number) => Math.max(0, Math.min(1, (v - from) / (to - from)));

/** How far the light on the face can be trusted for gaze (0..1), and what the user could change, if anything. */
export function readLight({ face, contrast, scene }: LightLevels): { trust: number; advice: LightAdvice } {
  const trust = Math.min(ramp(face, 25, 80), 1 - ramp(face, 215, 245), ramp(contrast, 8, 25));
  const advice: LightAdvice = scene - face > 50 && face < 110 ? 'backlit' : face < 60 ? 'dim' : face > 225 ? 'bright' : null;
  return { trust, advice };
}
