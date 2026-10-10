/** Opens the user-facing webcam. Video frames never leave this page. */
export function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
  });
}

/** True inside the installed extension, false in the localhost playground. */
export function isExtensionPage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
}
