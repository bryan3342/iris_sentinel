import { MediaPipeFaceProvider } from '../providers/mediapipe/provider';
import { isExtensionPage, openCamera } from './setup/camera';

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
  const provider = new MediaPipeFaceProvider(video);
  const readout = document.createElement('p');
  root.append(readout);
  provider.onSample((sample) => {
    const eye = sample.eye ? `x ${sample.eye.x.toFixed(2)}  y ${sample.eye.y.toFixed(2)}` : 'not tracked';
    readout.textContent =
      `Eyes ${eye} | Blink L ${sample.blink.left.toFixed(2)} R ${sample.blink.right.toFixed(2)} | ` +
      `Talking ${sample.talking ? 'yes' : 'no'}`;
  });
  await provider.start();
  status.textContent = 'Eye tracking on. Processing stays on this computer.';
}

function grantButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = 'Allow camera';
  button.addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
  });
  return button;
}
