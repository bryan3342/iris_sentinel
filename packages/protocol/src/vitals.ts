import type { Unsubscribe } from './common';

/**
 * Vitals sensing contract: heart rate, breathing rate and heart rate
 * variability, for slow trends such as fatigue. Implemented by the Presage
 * companion (and a simulated provider); callers never see vendor types. Never
 * shown as a medical reading, and never used for confirms.
 */

/** One measurement and how far to trust it. */
export interface Reading {
  value: number;
  /** 0 (no trust) to 1 (full trust). */
  confidence: number;
  /** True once the reading has passed the provider's accuracy bar; ignore it until then. */
  stable: boolean;
}

export interface VitalsSample {
  /** Monotonic timestamp in milliseconds, stamped by Iris when the sample arrives. */
  t: number;
  /** Heart rate in beats per minute. Null while there is no reading. */
  pulse: Reading | null;
  /** Breaths per minute. Null while there is no reading. */
  breathing: Reading | null;
  /** Heart rate variability (RMSSD), compared only against the user's own baseline. */
  hrv: Reading | null;
}

export interface VitalsProvider {
  start(): Promise<void>;
  stop(): void;
  onVitals(listener: (sample: VitalsSample) => void): Unsubscribe;
}
