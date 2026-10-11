import type { Reading } from '@iris/protocol';
import { quantile } from './stats';

/**
 * The current value of one vitals signal (breathing or heart rate
 * variability) for the fatigue score: the median of the usable readings from
 * the last 30 s. A reading is usable once Presage marks it stable and at least
 * half confident. Camera-based readings spike now and then, and the median
 * shrugs off a few odd ones. Readings stay in memory only; they leave the
 * window by age, and `clear` drops them all for a new session.
 */

export interface VitalsWindowOptions {
  /** How far back readings count, in milliseconds. */
  windowMs?: number;
  /** Usable readings needed in the window before there is a value. */
  minReadings?: number;
  /** Lowest confidence (0 to 1) a stable reading may have and still count. */
  minConfidence?: number;
}

export class VitalsWindow {
  private readonly windowMs: number;
  private readonly minReadings: number;
  private readonly minConfidence: number;
  private readings: { t: number; value: number }[] = [];

  constructor({ windowMs = 30_000, minReadings = 10, minConfidence = 0.5 }: VitalsWindowOptions = {}) {
    this.windowMs = windowMs;
    this.minReadings = minReadings;
    this.minConfidence = minConfidence;
  }

  /** Adds the reading taken at `t`, if it is usable. */
  add(t: number, reading: Reading | null): void {
    if (!reading || !reading.stable || !(reading.confidence >= this.minConfidence) || !Number.isFinite(reading.value)) return;
    this.readings = [...this.readings.filter((r) => r.t > t - this.windowMs), { t, value: reading.value }];
  }

  /** Median of the usable readings in the window ending at `t`, or null with too few. */
  value(t: number): number | null {
    const recent = this.readings.filter((r) => r.t > t - this.windowMs && r.t <= t);
    return recent.length < this.minReadings ? null : quantile(recent.map((r) => r.value), 0.5);
  }

  clear(): void {
    this.readings = [];
  }
}
