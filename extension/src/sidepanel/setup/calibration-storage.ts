import type { AccuracyReport, CalibrationSample, StoredSample } from '@iris/core';

// Saved calibrations are keyed by the screen they were made on, since a
// different screen or scaling changes the eye-to-screen map. Only numbers are
// stored (eye features, head pose, dot positions), never frames or landmarks,
// and they never leave this device: extension storage inside the extension,
// the page's own local storage in the playground. Accuracy checks are kept the
// same way, with their samples, so a later fit can be scored on them again.

const screenKey = () => `${screen.width}x${screen.height}@${window.devicePixelRatio}`;
const calibrationKey = () => `iris:calibration:${screenKey()}`;
const checksKey = () => `iris:accuracy:${screenKey()}`;
const MAX_CHECKS = 10;

/** One accuracy check: its result and the samples behind it (targets in the same screen frame as calibration). */
export interface AccuracyRecord {
  at: number;
  report: AccuracyReport;
  frame: { width: number; height: number };
  samples: CalibrationSample[];
}

function extensionStorage(): chrome.storage.StorageArea | null {
  return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
}

async function readList<T>(key: string): Promise<T[]> {
  const area = extensionStorage();
  const raw = area ? (await area.get(key))[key] : localStorage.getItem(key);
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return []; // a damaged entry just means starting again
  }
}

async function writeList<T>(key: string, items: T[]): Promise<void> {
  const area = extensionStorage();
  if (area) await area.set({ [key]: items });
  else localStorage.setItem(key, JSON.stringify(items));
}

export function loadSamples(): Promise<StoredSample[]> {
  return readList<StoredSample>(calibrationKey());
}

export function saveSamples(samples: StoredSample[]): Promise<void> {
  return writeList(calibrationKey(), samples);
}

export async function clearSamples(): Promise<void> {
  const area = extensionStorage();
  if (area) await area.remove(calibrationKey());
  else localStorage.removeItem(calibrationKey());
}

/** Saved accuracy checks for this screen, oldest first. */
export function loadChecks(): Promise<AccuracyRecord[]> {
  return readList<AccuracyRecord>(checksKey());
}

/** Adds a check, keeping the most recent ten; returns them all, oldest first. */
export async function saveCheck(record: AccuracyRecord): Promise<AccuracyRecord[]> {
  const checks = [...(await loadChecks()), record].slice(-MAX_CHECKS);
  await writeList(checksKey(), checks);
  return checks;
}
