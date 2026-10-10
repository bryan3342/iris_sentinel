import { MediaPipeGazeProvider } from '../providers/mediapipe/provider';
import { companionPanel } from './companion-status';
import { isExtensionPage, openCamera } from './setup/camera';
import { gazePanel } from './gaze-panel';
import { numbersPanel } from './numbers';
import { PageMarks } from './page-marks';
import { pageAccessPanel } from './setup/page-access';
import { LiveTargetList } from './target-list';
import { EyeTrace } from './trace';
import { understandingPanel } from './understanding';
import { microphonePanel } from './setup/microphone';

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
  const targets = new LiveTargetList();
  const marks = new PageMarks(targets);
  const gaze = gazePanel(marks, targets);
  if (isExtensionPage()) {
    root.append(microphonePanel(), pageAccessPanel(), numbersPanel(marks), gaze.element, understandingPanel(marks), companionPanel());
  }

  openCamera()
    .then((stream) => {
      video.srcObject = stream;
      return startTracking(video, preview, root, status);
    })
    .then((provider) => gaze.useCamera(provider))
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
): Promise<MediaPipeGazeProvider> {
  status.textContent = 'Loading eye tracking...';
  const provider = new MediaPipeGazeProvider(video);
  const trace = new EyeTrace(video);
  preview.append(trace.overlay);
  root.append(trace.readout);
  provider.onTracePoints((points) => trace.drawPoints(points));
  provider.onSample((sample) => trace.addSample(sample));
  await provider.start();
  status.textContent = 'Eye tracking on. Processing stays on this computer.';
  return provider;
}

function grantButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = 'Allow camera';
  button.addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
  });
  return button;
}
