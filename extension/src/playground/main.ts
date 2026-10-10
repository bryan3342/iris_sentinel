import type { GazeSample } from '@iris/protocol';
import { MediaPipeGazeProvider } from '../providers/mediapipe/provider';
import { GazeDot } from '../sidepanel/gaze-dot';
import { runCalibration } from '../sidepanel/setup/calibration';
import { openCamera } from '../sidepanel/setup/camera';
import { EyeTrace } from '../sidepanel/trace';

// Full-window gaze playground for local development: the camera fills the
// window, calibration starts once a face is steady, then a red circle shows
// where the user is looking. Press R to recalibrate. Add ?dots=5 for 5 dots.
const STEADY_SAMPLES = 30; // about one second of a tracked face before calibrating

const stage = document.getElementById('stage')!;
const video = document.createElement('video');
video.autoplay = video.muted = video.playsInline = true;
const hud = document.createElement('p');
hud.className = 'hud';
stage.append(video, hud);

const dotCount = new URLSearchParams(location.search).get('dots') === '5' ? 5 : 9;
let gaze: { dot: GazeDot; unsubscribe: () => void } | null = null;
let calibrating = false;

async function calibrate(provider: MediaPipeGazeProvider): Promise<void> {
  if (calibrating) return;
  calibrating = true;
  gaze?.unsubscribe();
  gaze?.dot.remove();
  gaze = null;
  hud.textContent = `Look at each dot until it disappears (${dotCount} dots).`;
  try {
    const dot = new GazeDot(await runCalibration(provider, stage, dotCount), stage);
    gaze = { dot, unsubscribe: provider.onSample((sample) => dot.update(sample)) };
    hud.textContent = 'Tracking your gaze. Press R to recalibrate.';
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
  hud.textContent = 'Look at the screen and hold still.';
  await waitForSteadyFace(provider);
  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'r') void calibrate(provider);
  });
  await calibrate(provider);
}

start().catch(() => {
  hud.textContent = 'Camera is off. Allow it from the camera icon in the address bar, then reload.';
});
