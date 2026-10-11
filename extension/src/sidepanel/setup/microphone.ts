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
  const button = document.createElement('button'); button.textContent = 'Allow microphone';
  button.addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('permission.html?device=microphone') });
  });
  panel.append(title, button);
  return panel;
}
