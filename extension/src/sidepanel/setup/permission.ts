import { openCamera } from './camera';
import { openMicrophone } from './microphone';

// Side panels cannot show Chrome's camera prompt, so the side panel opens this
// tab once. The grant applies to the whole extension.
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
    if (status) status.textContent = `${device} allowed. You can close this tab and return to the Iris panel.`;
  })
  .catch(() => {
    if (status) status.textContent = `${device} blocked. Allow it from Chrome's site permissions, then reload.`;
  });
