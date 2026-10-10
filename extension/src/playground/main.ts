import { CalibrationStore } from '@iris/core';
import type { GazeSample } from '@iris/protocol';
import { MediaPipeGazeProvider } from '../providers/mediapipe/provider';
import { GazeDot } from '../sidepanel/gaze-dot';
import { runCalibration } from '../sidepanel/setup/calibration';
import { clearSamples, loadSamples, saveSamples } from '../sidepanel/setup/calibration-storage';
import { openCamera } from '../sidepanel/setup/camera';
import { EyeTrace } from '../sidepanel/trace';

// Full-window gaze playground for local development: the camera fills the
// window and a red circle shows where the user is looking. A saved calibration
// for this screen is used right away; otherwise calibration starts once a face
// is steady. Clicking stands in for a confirm gesture: the click position is a
// confirmed target and refines the fit. Press R to redo the dots, X to forget
// everything saved. Add ?dots=5 for 5 dots.
const STEADY_SAMPLES = 30; // about one second of a tracked face before calibrating

const stage = document.getElementById('stage')!;
const video = document.createElement('video');
video.autoplay = video.muted = video.playsInline = true;
const hud = document.createElement('p');
hud.className = 'hud';
stage.append(video, hud);

const dotCount = new URLSearchParams(location.search).get('dots') === '5' ? 5 : 9;
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
let store = new CalibrationStore();
let dot: GazeDot | null = null;
let stopDot: (() => void) | null = null;
let calibrating = false;

function trackingHud(): void {
  const confirms = store.samples.filter((s) => s.source === 'confirm').length;
  hud.textContent = `Tracking your gaze. Click where you look to refine (${confirms} confirms). R: redo dots. X: forget.`;
}

function showDot(provider: MediaPipeGazeProvider): void {
  stopDot?.();
  dot?.remove();
  const next = new GazeDot(store, stage);
  dot = next;
  stopDot = provider.onSample((sample) => next.update(sample));
  trackingHud();
}

async function calibrate(provider: MediaPipeGazeProvider): Promise<void> {
  if (calibrating) return;
  calibrating = true;
  stopDot?.();
  stopDot = null;
  dot?.remove();
  dot = null;
  hud.textContent = `Look at each dot until it disappears (${dotCount} dots).`;
  try {
    store.setDots(await runCalibration(provider, stage, dotCount), viewport());
    await saveSamples(store.samples);
    showDot(provider);
  } catch {
    hud.textContent = 'Calibration needs your face in view. Press R to try again.';
  } finally {
    calibrating = false;
  }
}

/** Resolves once the face has been tracked for a short unbroken stretch. */
function waitForSteadyFace(provider: MediaPipeGazeProvider): Promise<void> {
  return new Promise((resolve) => {
    let steady = 0;
    const unsubscribe = provider.onSample((sample: GazeSample) => {
      steady = sample.eye ? steady + 1 : 0;
      if (steady < STEADY_SAMPLES) return;
      unsubscribe();
      resolve();
    });
  });
}

async function start(): Promise<void> {
  hud.textContent = 'Starting camera...';
  video.srcObject = await openCamera();
  const provider = new MediaPipeGazeProvider(video);
  const trace = new EyeTrace(video);
  stage.append(trace.overlay);
  provider.onTracePoints((points) => trace.drawPoints(points));
  hud.textContent = 'Loading eye tracking...';
  await provider.start();

  document.addEventListener('keydown', (event) => {
    const k = event.key.toLowerCase();
    if (k === 'r') void calibrate(provider);
    if (k === 'x') {
      void clearSamples();
      store = new CalibrationStore();
      stopDot?.();
      stopDot = null;
      dot?.remove();
      dot = null;
      hud.textContent = 'Saved calibration forgotten. Press R to calibrate.';
    }
  });
  stage.addEventListener('click', (event) => {
    if (!dot || calibrating) return;
    const accepted = dot.confirm({ x: event.clientX, y: event.clientY });
    if (accepted) void saveSamples(store.samples);
    trackingHud();
    if (!accepted) hud.textContent += ' (Last click was too far from your gaze and was ignored.)';
  });

  try {
    store = new CalibrationStore(await loadSamples(), viewport());
  } catch {
    // Saved samples that no longer fit (wrong shape, degenerate): calibrate again.
    void clearSamples();
    store = new CalibrationStore();
  }
  if (store.model) {
    showDot(provider);
    return;
  }
  hud.textContent = 'Look at the screen and hold still.';
  await waitForSteadyFace(provider);
  await calibrate(provider);
}

start().catch((error: unknown) => {
  if (video.srcObject) {
    hud.textContent = 'Eye tracking failed to start.';
    console.error('Iris: eye tracking failed', error);
    return;
  }
  hud.textContent = 'Camera is off. Allow it from the camera icon in the address bar, then reload.';
});
