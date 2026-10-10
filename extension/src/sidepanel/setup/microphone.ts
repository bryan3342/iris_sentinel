/** Permission probe only. Callers must stop all tracks when the probe completes. */
export function openMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: false,
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

export function microphonePanel(): HTMLElement {
  const panel = document.createElement('section');
  const title = document.createElement('h2'); title.textContent = 'Voice setup';
  const notice = document.createElement('p');
  notice.textContent = 'Allow your microphone before starting a voice conversation. This setup only checks permission and immediately turns the microphone off.';
  const button = document.createElement('button'); button.textContent = 'Allow microphone';
  button.addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('permission.html?device=microphone') });
  });
  panel.append(title, notice, button);
  return panel;
}
