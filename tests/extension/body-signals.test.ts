import { describe, expect, it } from 'vitest';
import {
  type BodySignals,
  bodySignalsView,
  initialBodySignals,
  STALE_MS,
  withLink,
  withQuality,
  withStatus,
  withVitals,
} from '../../extension/src/sidepanel/body-signals';

const steady = (value: number) => ({ value, confidence: 0.9, stable: true });
const unsteady = (value: number) => ({ value, confidence: 0.2, stable: false });

/** Connected and measuring since t = 0. */
const measuring = (): BodySignals => withStatus(withLink(initialBodySignals('connecting'), 'connected'), 'running', 0);

describe('status line', () => {
  it('tells the user how to fix a missing companion', () => {
    expect(bodySignalsView(initialBodySignals('not-installed'), 0).status).toContain('npm run install:host');
  });

  it('says what the companion is doing once connected', () => {
    const connected = withLink(initialBodySignals('connecting'), 'connected');
    expect(bodySignalsView(connected, 0).status).toBe('Body signals: companion connected.');
    expect(bodySignalsView(withStatus(connected, 'starting', 0), 0).status).toBe('Body signals: starting the camera measurement...');
    expect(bodySignalsView(measuring(), 0).status).toBe('Body signals: measuring.');
  });

  it('explains each problem the companion can report', () => {
    const connected = withLink(initialBodySignals('connecting'), 'connected');
    expect(bodySignalsView(withStatus(connected, 'key-missing', 0), 0).status).toContain('key is not stored');
    expect(bodySignalsView(withStatus(connected, 'credits-exhausted', 0), 0).status).toContain('no Presage credit');
    expect(bodySignalsView(withStatus(connected, 'camera-unavailable', 0), 0).status).toContain('Iris Companion');
  });

  it('forgets what the companion said once the connection drops', () => {
    expect(bodySignalsView(withLink(measuring(), 'disconnected'), 0)).toEqual({
      status: 'Body signals: companion stopped. Close and reopen this panel to try again.',
      camera: null,
      signals: [],
      note: null,
    });
  });
});

describe('camera hint', () => {
  it("shows Presage's own hint while the view is not good enough", () => {
    const state = withQuality(measuring(), { t: 0, quality: 'chest-not-visible', hint: 'Place more of the chest in view.' });
    expect(bodySignalsView(state, 0).camera).toBe('Camera: Place more of the chest in view.');
  });

  it('falls back to its own advice when Presage gives no hint', () => {
    expect(bodySignalsView(withQuality(measuring(), { t: 0, quality: 'too-dark', hint: '' }), 0).camera).toBe(
      'Camera: Too dark. Add light in front of you.',
    );
  });

  it('shows nothing once the view is good, and keeps the hint while starting', () => {
    expect(bodySignalsView(withQuality(measuring(), { t: 0, quality: 'ok', hint: 'Hold still and record.' }), 0).camera).toBeNull();
    const starting = withStatus(withLink(initialBodySignals('connecting'), 'connected'), 'starting', 0);
    expect(bodySignalsView(withQuality(starting, { t: 0, quality: 'no-face', hint: 'No face found.' }), 0).camera).toBe('Camera: No face found.');
  });
});

describe('signals', () => {
  it('counts down each warm-up while measuring', () => {
    expect(bodySignalsView(measuring(), 5_000).signals).toEqual([
      'Heart rate: warming up, about 7s',
      'Breathing: warming up, about 25s',
      'Heart rate variability: warming up, about 55s',
    ]);
  });

  it('shows heart rate and breathing once stable, and HRV as ready without a number', () => {
    const state = withVitals(measuring(), { t: 40_000, pulse: steady(71.6), breathing: steady(14.2), hrv: steady(42) });
    expect(bodySignalsView(state, 41_000).signals).toEqual([
      'Heart rate: about 72 beats a minute',
      'Breathing: about 14 breaths a minute',
      'Heart rate variability: ready',
    ]);
  });

  it('does not show a reading Presage does not trust yet', () => {
    const state = withVitals(measuring(), { t: 40_000, pulse: unsteady(90), breathing: null, hrv: null });
    expect(bodySignalsView(state, 40_500).signals[0]).toBe('Heart rate: waiting for a steady reading');
  });

  it('drops a reading once it goes stale, as when the face leaves the camera', () => {
    const state = withVitals(measuring(), { t: 40_000, pulse: steady(72), breathing: null, hrv: null });
    expect(bodySignalsView(state, 40_000 + STALE_MS + 1).signals[0]).toBe('Heart rate: waiting for a steady reading');
  });

  it('keeps the last reading of a signal a newer sample does not carry', () => {
    let state = withVitals(measuring(), { t: 40_000, pulse: steady(72), breathing: null, hrv: null });
    state = withVitals(state, { t: 41_000, pulse: null, breathing: steady(14), hrv: null });
    expect(bodySignalsView(state, 41_500).signals.slice(0, 2)).toEqual([
      'Heart rate: about 72 beats a minute',
      'Breathing: about 14 breaths a minute',
    ]);
  });

  it('notes these are estimates, and shows no signals before measuring starts', () => {
    expect(bodySignalsView(measuring(), 0).note).toBe('Estimates from the camera, not medical readings.');
    const starting = withStatus(withLink(initialBodySignals('connecting'), 'connected'), 'starting', 0);
    expect(bodySignalsView(starting, 0)).toMatchObject({ signals: [], note: null });
  });

  it('starts the warm-up over after measuring stops and resumes', () => {
    let state = withVitals(measuring(), { t: 40_000, pulse: steady(72), breathing: null, hrv: null });
    state = withStatus(withStatus(state, 'stopped', 50_000), 'running', 60_000);
    expect(bodySignalsView(state, 61_000).signals[0]).toBe('Heart rate: warming up, about 11s');
  });
});
