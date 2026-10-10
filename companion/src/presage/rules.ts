import type { CompanionState } from '@iris/protocol';

// Presage settings and what its errors mean for Iris. Kept free of the SDK so
// CI tests them without it installed; session.ts passes in the SDK's own values.

/** The SmartSpectraSDK options Iris uses. */
export interface PresageOptions {
  apiKey: string;
  requestedMetrics: number[];
  enableTelemetry: false;
}

/**
 * Options for a session: only the metric groups Iris uses (breathing, cardio
 * and face), and telemetry off. Iris never uses LLM Insights, which would send
 * measurements off the laptop.
 */
export function presageOptions(apiKey: string, metricGroups: readonly (readonly number[])[]): PresageOptions {
  return { apiKey, requestedMetrics: [...new Set(metricGroups.flat())], enableTelemetry: false };
}

/** Presage error code names, by name, mapped to what the companion reports. */
const STATE_BY_ERROR: Record<string, CompanionState> = {
  kAuthenticationFailed: 'key-invalid',
  kCreditExhausted: 'credits-exhausted',
  kNetworkError: 'offline',
  kServerError: 'offline',
  kInputUnavailable: 'camera-unavailable',
};

/** What the companion reports for a Presage error. Anything Iris cannot act on is `error`. */
export function stateForError(codeName: string): CompanionState {
  return Object.hasOwn(STATE_BY_ERROR, codeName) ? STATE_BY_ERROR[codeName]! : 'error';
}
