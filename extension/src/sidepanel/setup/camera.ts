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

const CAMERA = { name: 'camera' as PermissionName };

/** Whether the camera is allowed for Iris right now. */
export async function cameraAllowed(): Promise<boolean> {
  try { return (await navigator.permissions.query(CAMERA)).state === 'granted'; } catch { return false; }
}

/** Calls `listener` whenever camera access changes, allowed in Chrome's prompt or removed later; returns a function that stops it. */
export function watchCamera(listener: () => void): () => void {
  let stopped = false;
  let status: PermissionStatus | null = null;
  void navigator.permissions.query(CAMERA).then((current) => {
    if (stopped) return;
    status = current;
    current.addEventListener('change', listener);
  }, () => {});
  return () => {
    stopped = true;
    status?.removeEventListener('change', listener);
  };
}
