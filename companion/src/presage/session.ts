import {
  breathingMetrics,
  CameraSelection,
  cardioMetrics,
  faceMetrics,
  ProcessingStatus,
  SmartSpectraErrorCode,
  SmartSpectraSDK,
  ValidationCode,
} from '@smartspectra/node-sdk';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import type { PresageMetrics } from './map';
import { presageOptions } from './rules';

// The one place the companion touches the Presage SDK. It opens the camera,
// measures on the laptop, and reports through plain callbacks using Presage's
// code names, which map.ts and rules.ts translate. It never logs, and never
// calls requestInsight (LLM Insights), which would send measurements off the laptop.

export interface PresageEvents {
  /** Measuring has started. */
  onRunning(): void;
  /** Camera quality for one frame: a Presage validation code name and its hint. */
  onQuality(codeName: string, hint: string): void;
  onMetrics(metrics: PresageMetrics): void;
  /** Presage failed, with its error code name. Not called while stopping. */
  onError(codeName: string): void;
}

const STOP_STEP_MS = 5_000;

const nameOf = (table: Record<string, number>, value: number) =>
  Object.keys(table).find((key) => table[key] === value) ?? 'unknown';

export class PresageSession {
  private readonly sdk: SmartSpectraSDK;
  private stopping = false;

  constructor(apiKey: string, private readonly events: PresageEvents) {
    this.sdk = new SmartSpectraSDK(presageOptions(apiKey, [breathingMetrics, cardioMetrics, faceMetrics]));
    // Each on() replaces the previous callback, so this class owns them all.
    this.sdk.on('processingStatus', (status) => {
      if (status === ProcessingStatus.kRunning) events.onRunning();
    });
    this.sdk.on('validationStatus', (code, _timestampUs, hint) => events.onQuality(nameOf(ValidationCode, code), hint));
    this.sdk.on('metrics', (buf) => events.onMetrics(decodeMetrics(buf)));
    // Stopping reports a harmless kInvalidState, so errors are ignored from then on.
    this.sdk.on('error', (code) => {
      if (!this.stopping) events.onError(nameOf(SmartSpectraErrorCode, code));
    });
  }

  /** Opens the default camera and starts measuring. Problems arrive through onError. */
  start(): void {
    try {
      this.sdk.useCamera(CameraSelection.default);
      this.sdk.start();
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      this.events.onError(typeof code === 'number' ? nameOf(SmartSpectraErrorCode, code) : 'unknown');
    }
  }

  /** Stops measuring and releases the camera, waiting at most a few seconds per step. */
  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    await settle(this.sdk.stopAsync());
    await settle(this.sdk.destroy());
  }
}

/** Resolves when a step finishes, fails or runs out of time, whichever comes first. */
function settle(step: Promise<void>): Promise<void> {
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, STOP_STEP_MS).unref());
  return Promise.race([step.catch(() => undefined), timeout]);
}
