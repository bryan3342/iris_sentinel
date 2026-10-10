import { type FromCompanion, QUALITY_HINT_LIMIT } from '@iris/protocol';
import type { Sensing } from '../host';
import { type PresageMetrics, QualityChanges, VitalsWindow } from './map';
import { stateForError } from './rules';

// Runs Presage for the host: reads the key, starts a session, and turns what
// Presage reports into companion messages. The key reader and the session are
// passed in, so tests drive this with fakes and no camera, credits or SDK.

/** What a Presage session reports, using Presage's own code names. */
export interface PresageEvents {
  /** Measuring has started. */
  onRunning(): void;
  /** Camera quality for one frame: a Presage validation code name and its hint. */
  onQuality(codeName: string, hint: string): void;
  onMetrics(metrics: PresageMetrics): void;
  /** Presage failed, with its error code name. Not called while stopping. */
  onError(codeName: string): void;
}

/** The part of a Presage session that sensing drives. */
export interface PresageRun {
  start(): void;
  stop(): Promise<void>;
}

export interface PresageSensingOptions {
  /** The Presage key from the Keychain, or null when it is not stored. */
  readKey: () => Promise<string | null>;
  createSession: (apiKey: string, events: PresageEvents) => PresageRun;
  /** How often vitals are sent, in milliseconds. */
  vitalsEveryMs?: number;
  /**
   * How long to wait for the first camera frame before reporting
   * `camera-unavailable`. Without it, a camera the operating system never hands
   * over leaves the companion on "starting" with no error.
   */
  cameraTimeoutMs?: number;
}

export class PresageSensing implements Sensing {
  private session: PresageRun | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cameraTimer: ReturnType<typeof setTimeout> | null = null;
  /** The current run; events from an older, stopping run are ignored. */
  private run = 0;
  private active = false;

  constructor(private readonly options: PresageSensingOptions) {}

  start(send: (message: FromCompanion) => void): void {
    if (this.active) return;
    this.active = true;
    const run = ++this.run;
    void this.begin(run, send);
  }

  async stop(): Promise<void> {
    this.active = false;
    this.run++;
    if (this.timer !== null) clearInterval(this.timer);
    if (this.cameraTimer !== null) clearTimeout(this.cameraTimer);
    this.timer = this.cameraTimer = null;
    const session = this.session;
    this.session = null;
    await session?.stop();
  }

  private async begin(run: number, send: (message: FromCompanion) => void): Promise<void> {
    const current = () => run === this.run;
    send({ type: 'status', state: 'starting' });
    const key = await this.options.readKey();
    if (!current()) return;
    if (key === null) {
      this.active = false;
      send({ type: 'status', state: 'key-missing' });
      return;
    }
    const quality = new QualityChanges();
    const vitals = new VitalsWindow();
    // Presage reports camera quality for every frame, so the first report means the camera works.
    let sawFrame = false;
    const session = this.options.createSession(key, {
      onRunning: () => {
        if (current()) send({ type: 'status', state: 'running' });
      },
      onQuality: (code, hint) => {
        if (!current()) return;
        sawFrame = true;
        const change = quality.next(code, hint.slice(0, QUALITY_HINT_LIMIT));
        if (change) send({ type: 'quality', ...change });
      },
      onMetrics: (metrics) => {
        if (current()) vitals.add(metrics);
      },
      onError: (code) => {
        if (!current()) return;
        // Report what went wrong, then release the camera; the status stays visible.
        send({ type: 'status', state: stateForError(code) });
        void this.stop();
      },
    });
    this.session = session;
    this.timer = setInterval(() => {
      const taken = vitals.take();
      if (taken.pulse || taken.breathing || taken.hrv) send({ type: 'vitals', ...taken });
    }, this.options.vitalsEveryMs ?? 1000);
    this.cameraTimer = setTimeout(() => {
      if (!current() || sawFrame) return;
      send({ type: 'status', state: 'camera-unavailable' });
      void this.stop();
    }, this.options.cameraTimeoutMs ?? 15_000);
    session.start();
  }
}
