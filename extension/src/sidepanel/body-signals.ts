import type { CompanionState, Quality, QualityStatus, Reading, VitalsSample } from '@iris/protocol';
import type { LinkState } from '../providers/companion/link';

// What the side panel shows about body signals, as pure functions over a small
// state: the connection, what the companion reports, the Start or Stop button,
// Presage's camera hint, a warm-up countdown per signal, and readings once
// Presage trusts them. No DOM here, so it is tested directly;
// companion-status.ts renders it.

export type Signal = 'pulse' | 'breathing' | 'hrv';
const SIGNALS: Signal[] = ['pulse', 'breathing', 'hrv'];

/** How long Presage needs before each signal can be trusted, in milliseconds (its documented warm-up). */
export const WARM_UP_MS: Record<Signal, number> = { pulse: 12_000, breathing: 30_000, hrv: 60_000 };

/** A reading older than this is no longer shown, for example after the face leaves the camera. */
export const STALE_MS = 5_000;

export interface BodySignals {
  link: LinkState;
  companion: CompanionState | null;
  quality: QualityStatus | null;
  /** When the companion reported `running`, on the side panel clock. */
  runningSince: number | null;
  latest: Partial<Record<Signal, { t: number; reading: Reading }>>;
}

export const initialBodySignals = (link: LinkState): BodySignals => ({
  link,
  companion: null,
  quality: null,
  runningSince: null,
  latest: {},
});

/** A new connection state. Anything but `connected` forgets what the companion said. */
export function withLink(state: BodySignals, link: LinkState): BodySignals {
  return link === 'connected' ? { ...state, link } : initialBodySignals(link);
}

/** A new companion state. Leaving `running` clears the warm-up and the readings. */
export function withStatus(state: BodySignals, companion: CompanionState, now: number): BodySignals {
  if (companion === 'running') return { ...state, companion, runningSince: state.runningSince ?? now };
  return { ...state, companion, runningSince: null, latest: {}, quality: companion === 'starting' ? state.quality : null };
}

export function withQuality(state: BodySignals, quality: QualityStatus): BodySignals {
  return { ...state, quality };
}

/** Keeps the newest reading of each signal the sample carries. */
export function withVitals(state: BodySignals, sample: VitalsSample): BodySignals {
  const latest = { ...state.latest };
  for (const signal of SIGNALS) {
    const reading = sample[signal];
    if (reading) latest[signal] = { t: sample.t, reading };
  }
  return { ...state, latest };
}

const LINK_TEXT: Record<LinkState, string> = {
  idle: 'Body signals: off.',
  unavailable: 'Body signals: only available in the installed extension.',
  connecting: 'Body signals: connecting to the companion...',
  connected: 'Body signals: companion connected.',
  'not-installed': 'Body signals: companion not installed. Run npm run install:host in companion/, then start again.',
  outdated: 'Body signals: companion is out of date. Run npm run install:host in companion/, then start again.',
  disconnected: 'Body signals: companion stopped. Start again to retry.',
};

const COMPANION_TEXT: Record<CompanionState, string> = {
  starting: 'Body signals: starting the camera measurement...',
  running: 'Body signals: measuring.',
  stopped: 'Body signals: paused.',
  'key-missing': 'Body signals: the Presage key is not stored. See "Run the companion" in docs/local-development.md.',
  'key-invalid': 'Body signals: Presage did not accept the key. Store it again, then start again.',
  offline: 'Body signals: cannot reach Presage to check the key. Check the internet connection.',
  'credits-exhausted': 'Body signals: no Presage credit left. Check the Presage developer portal.',
  'camera-unavailable': 'Body signals: the camera is not available. Quit other camera apps, or allow Iris Companion in System Settings, Camera.',
  error: 'Body signals: Presage stopped with an error. Start again to retry.',
};

/** Advice when Presage reports a problem without its own hint. */
const QUALITY_TEXT: Record<Quality, string> = {
  ok: '',
  'no-face': 'No face found. Face the camera.',
  'multiple-faces': 'More than one face in view.',
  reposition: 'Center your face in the camera.',
  'too-dark': 'Too dark. Add light in front of you.',
  'too-bright': 'Too bright. Turn away from bright light.',
  'chest-not-visible': 'Lean back so your upper chest is in view.',
  motion: 'Hold still.',
  'camera-adjusting': 'The camera is adjusting.',
  'low-frame-rate': 'The camera is running slowly.',
};

const LABEL: Record<Signal, string> = { pulse: 'Heart rate', breathing: 'Breathing', hrv: 'Heart rate variability' };

/** Shown with any readings or graph, so none is taken for a medical reading. */
export const ESTIMATES_NOTE = 'Estimates from the camera, not medical readings.';

/** What the section's button does. Body signals never start on their own, since every Presage session uses credits. */
export type BodyAction = 'start' | 'stop';

export interface BodySignalsView {
  status: string;
  /** The button, or null where there is no companion (the localhost playground). */
  action: BodyAction | null;
  /** Presage's advice while the camera view is not good enough, or null. */
  camera: string | null;
  /** One line per signal while measuring. */
  signals: string[];
  /** Shown with the signals. */
  note: string | null;
}

export function bodySignalsView(state: BodySignals, now: number): BodySignalsView {
  const status = state.link === 'connected' && state.companion ? COMPANION_TEXT[state.companion] : LINK_TEXT[state.link];
  const action = actionFor(state);
  const sensing = state.companion === 'starting' || state.companion === 'running';
  const problem = sensing && state.quality && state.quality.quality !== 'ok' ? state.quality : null;
  const camera = problem ? `Camera: ${problem.hint || QUALITY_TEXT[problem.quality]}` : null;
  if (state.companion !== 'running' || state.runningSince === null) return { status, action, camera, signals: [], note: null };
  const elapsed = now - state.runningSince;
  const signals = SIGNALS.map((signal) => `${LABEL[signal]}: ${signalText(signal, state.latest[signal], elapsed, now)}`);
  return { status, action, camera, signals, note: ESTIMATES_NOTE };
}

/**
 * Stop while connecting or measuring. Start otherwise, including after the
 * companion reports a problem: the connection may still be open then, but
 * nothing is measuring, so starting again is the way to retry.
 */
function actionFor(state: BodySignals): BodyAction | null {
  if (state.link === 'unavailable') return null;
  if (state.link === 'connecting') return 'stop';
  const sensing = state.companion === null || state.companion === 'starting' || state.companion === 'running';
  return state.link === 'connected' && sensing ? 'stop' : 'start';
}

function signalText(signal: Signal, latest: { t: number; reading: Reading } | undefined, elapsed: number, now: number): string {
  const fresh = latest && now - latest.t <= STALE_MS ? latest.reading : null;
  if (fresh?.stable) {
    if (signal === 'hrv') return 'ready';
    const unit = signal === 'pulse' ? 'beats' : 'breaths';
    return `about ${Math.round(fresh.value)} ${unit} a minute`;
  }
  const left = Math.ceil((WARM_UP_MS[signal] - elapsed) / 1000);
  return left > 0 ? `warming up, about ${left}s` : 'waiting for a steady reading';
}
