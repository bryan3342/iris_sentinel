import { openCamera } from './camera';

// Side panels cannot show Chrome's camera prompt, so the side panel opens this
// tab once. The grant applies to the whole extension.
const status = document.getElementById('status');

openCamera()
  .then((stream) => {
    stream.getTracks().forEach((track) => track.stop());
    if (status) status.textContent = 'Camera allowed. You can close this tab and reopen the Iris panel.';
  })
  .catch(() => {
    if (status) status.textContent = 'Camera blocked. Allow it from the camera icon in the address bar, then reload.';
  });
