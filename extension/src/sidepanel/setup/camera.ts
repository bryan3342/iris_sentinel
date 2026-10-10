/**
 * Opens the user-facing webcam. Video frames never leave this page. 720p is
 * requested because iris landmarks move only a few pixels at 480p, so
 * resolution directly sets how finely gaze can be measured.
 */
export function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
  });
}

/** True inside the installed extension, false in the localhost playground. */
export function isExtensionPage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
}
