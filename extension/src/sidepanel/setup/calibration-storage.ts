import type { StoredSample } from '@iris/core';

// Saved calibrations are keyed by the screen they were made on, since a
// different screen or scaling changes the eye-to-screen map. Only numbers are
// stored (eye features, head pose, dot positions), never frames or landmarks,
// and they never leave this device: extension storage inside the extension,
// the page's own local storage in the playground.

const key = () => `iris:calibration:${screen.width}x${screen.height}@${window.devicePixelRatio}`;

function extensionStorage(): chrome.storage.StorageArea | null {
  return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
}

export async function loadSamples(): Promise<StoredSample[]> {
  const area = extensionStorage();
  const raw = area ? (await area.get(key()))[key()] : localStorage.getItem(key());
  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) ? (parsed as StoredSample[]) : [];
}

export async function saveSamples(samples: StoredSample[]): Promise<void> {
  const area = extensionStorage();
  if (area) await area.set({ [key()]: samples });
  else localStorage.setItem(key(), JSON.stringify(samples));
}

export async function clearSamples(): Promise<void> {
  const area = extensionStorage();
  if (area) await area.remove(key());
  else localStorage.removeItem(key());
}
