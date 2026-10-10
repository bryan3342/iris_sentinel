import { isExtensionPage, openCamera } from './setup/camera';

/** Builds the side panel UI. Shared by the extension and the playground. */
export function mountPanel(root: HTMLElement): void {
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;

  const status = document.createElement('p');
  status.className = 'status';
  status.textContent = 'Starting camera...';

  root.replaceChildren(video, status);

  openCamera()
    .then((stream) => {
      video.srcObject = stream;
      status.textContent = 'Camera on. Processing stays on this computer.';
    })
    .catch(() => {
      status.textContent = 'Camera is off.';
      if (isExtensionPage()) root.append(grantButton());
    });
}

function grantButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = 'Allow camera';
  button.addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
  });
  return button;
}
