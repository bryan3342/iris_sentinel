import { MediaPipeGazeProvider } from '../providers/mediapipe/provider';
import { GazeDot } from './gaze-dot';
import { runCalibration } from './setup/calibration';
import { isExtensionPage, openCamera } from './setup/camera';
import { EyeTrace } from './trace';

/** Builds the side panel UI. Shared by the extension and the playground. */
export function mountPanel(root: HTMLElement): void {
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;

  const preview = document.createElement('div');
  preview.className = 'preview';
  preview.append(video);

  const status = document.createElement('p');
  status.className = 'status';
  status.textContent = 'Starting camera...';

  root.replaceChildren(preview, status);

  openCamera()
    .then((stream) => {
      video.srcObject = stream;
      return startTracking(video, preview, root, status);
    })
    .catch((error: unknown) => {
      if (video.srcObject) {
        status.textContent = 'Eye tracking failed to start.';
        console.error('Iris: eye tracking failed', error);
        return;
      }
      status.textContent = 'Camera is off.';
      if (isExtensionPage()) root.append(grantButton());
    });
}

async function startTracking(
  video: HTMLVideoElement,
  preview: HTMLElement,
  root: HTMLElement,
  status: HTMLElement,
): Promise<void> {
  status.textContent = 'Loading eye tracking...';
  const provider = new MediaPipeGazeProvider(video);
  const trace = new EyeTrace(video);
  preview.append(trace.overlay);
  root.append(trace.readout);
  provider.onTracePoints((points) => trace.drawPoints(points));
  provider.onSample((sample) => trace.addSample(sample));
  await provider.start();
  status.textContent = 'Eye tracking on. Processing stays on this computer.';
  // The playground draws the gaze dot on its own page. Real pages need the content script.
  if (!isExtensionPage()) root.append(calibrateButton(provider, status));
}

function calibrateButton(provider: MediaPipeGazeProvider, status: HTMLElement): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = 'Calibrate';
  let gaze: { dot: GazeDot; unsubscribe: () => void } | null = null;
  button.addEventListener('click', async () => {
    button.disabled = true;
    gaze?.unsubscribe();
    gaze?.dot.remove();
    gaze = null;
    // Fullscreen makes the page cover the monitor in front of the user.
    await document.documentElement.requestFullscreen().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const dot = new GazeDot(await runCalibration(provider));
      gaze = { dot, unsubscribe: provider.onSample((sample) => dot.update(sample)) };
      button.textContent = 'Recalibrate';
      status.textContent = 'Calibrated. Stay in fullscreen; the circle follows your gaze.';
    } catch {
      status.textContent = 'Calibration failed. Keep your face in view and try again.';
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function grantButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = 'Allow camera';
  button.addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
  });
  return button;
}
