import { openCamera } from './camera';
import { openMicrophone } from './microphone';

// Side panels cannot show Chrome's camera prompt, so the side panel opens this
// tab once (setup opens it by itself). The grant applies to the whole
// extension, and the tab closes itself once access is allowed, returning the
// person to the page they were on.
const status = document.getElementById('status');

const microphone = new URL(location.href).searchParams.get('device') === 'microphone';
const device = microphone ? 'Microphone' : 'Camera';
const heading = document.querySelector('h1');
if (heading) heading.textContent = `${device} access`;
if (status) status.textContent = microphone
  ? 'Chrome will ask to use your microphone for voice conversation. This permission check sends no audio.'
  : 'Chrome will ask to use your camera. Video stays on this computer.';

(microphone ? openMicrophone() : openCamera())
  .then((stream) => {
    stream.getTracks().forEach((track) => track.stop());
    if (status) status.textContent = `${device} allowed. Returning to Iris.`;
    void chrome.tabs.getCurrent().then((tab) => (tab?.id === undefined ? undefined : chrome.tabs.remove(tab.id))).catch(() => {});
  })
  .catch(() => {
    if (status) status.textContent = `${device} blocked. Allow it from Chrome's site permissions, then reload.`;
  });
