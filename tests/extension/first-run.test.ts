import { expect, it } from 'vitest';
import { runSetup, type SetupDeps, type SetupView } from '../../extension/src/sidepanel/setup/first-run';

const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

/** Setup against fakes that record every step, in order. */
function harness({ done = false, camera = true, websites = true, calibrated = true, calibrations = [true], audio = true } = {}) {
  const log: string[] = [];
  let access = { camera, websites };
  let setupDone = done;
  let attempts = 0;
  let allow: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const view: SetupView = {
    show: (slide) => { log.push(`show ${slide.line}`); },
    needs: (missing, allowWebsites) => {
      log.push(`needs ${[missing.camera && 'camera', missing.websites && 'websites'].filter(Boolean).join('+')}`);
      allow = allowWebsites;
    },
    close: () => { log.push('close'); },
  };
  const deps: SetupDeps = {
    say: async (line) => { log.push(`say ${line}`); return audio; },
    access: async () => access,
    onAccessChange: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    askCamera: () => { log.push('ask camera'); },
    askWebsites: () => { log.push('ask websites'); },
    calibrated: async () => calibrated,
    calibrate: async () => {
      const ok = calibrations[Math.min(attempts++, calibrations.length - 1)]!;
      log.push(`calibrate ${ok ? 'ok' : 'failed'}`);
      return ok;
    },
    done: async () => setupDone,
    markDone: async () => { setupDone = true; log.push('done'); },
  };
  const grant = (what: Partial<typeof access>) => { access = { ...access, ...what }; listeners.forEach((listener) => listener()); };
  return { log, view, deps, grant, allowWebsites: () => allow?.(), listeners };
}

it('first run: each slide shows before its line plays, then the dots, then the farewell, and only then is setup done', async () => {
  const { log, view, deps } = harness();
  expect(await runSetup(view, deps)).toEqual({ spoke: true });
  expect(log).toEqual([
    'show welcome', 'say welcome', 'show aim', 'say aim', 'show scroll', 'say scroll', 'show voice', 'say voice',
    'show calibrate', 'say calibrate', 'calibrate ok',
    'show enjoy', 'say enjoy', 'done', 'close',
  ]);
});

it('keeps going on the captions when Iris\'s voice cannot play', async () => {
  const { log, view, deps } = harness({ audio: false });
  await runSetup(view, deps);
  expect(log.slice(-3)).toEqual(['say enjoy', 'done', 'close']);
});

it('opens the camera prompt by itself, offers website access as a button, and waits until both are allowed', async () => {
  const { log, view, deps, grant, allowWebsites, listeners } = harness({ camera: false, websites: false });
  const run = runSetup(view, deps);
  await flush();
  expect(log.filter((step) => step === 'ask camera')).toHaveLength(1);
  expect(log.at(-1)).toBe('needs camera+websites');
  expect(log).not.toContain('show calibrate');
  allowWebsites();
  expect(log.at(-1)).toBe('ask websites');
  grant({ camera: true });
  await flush();
  expect(log.at(-1)).toBe('needs websites');
  grant({ websites: true });
  await run;
  expect(log.slice(-7)).toEqual(['show calibrate', 'say calibrate', 'calibrate ok', 'show enjoy', 'say enjoy', 'done', 'close']);
  expect(listeners.size).toBe(0); // stops listening once access is granted
});

it('starts the dots again until a calibration is saved, saying the line only once', async () => {
  const { log, view, deps } = harness({ calibrations: [false, false, true] });
  await runSetup(view, deps);
  expect(log.filter((step) => step === 'say calibrate')).toHaveLength(1);
  expect(log.filter((step) => step.startsWith('calibrate '))).toEqual(['calibrate failed', 'calibrate failed', 'calibrate ok']);
  expect(log.indexOf('done')).toBeGreaterThan(log.lastIndexOf('calibrate ok'));
});

it('asks for access again if it is removed while the dots are being retried', async () => {
  const { log, view, deps, grant } = harness({ calibrations: [false, true] });
  deps.calibrate = async () => {
    const first = !log.includes('calibrate failed');
    log.push(first ? 'calibrate failed' : 'calibrate ok');
    if (first) grant({ websites: false });
    return !first;
  };
  const run = runSetup(view, deps);
  await flush();
  expect(log.at(-1)).toBe('needs websites');
  grant({ websites: true });
  await run;
  expect(log).toContain('calibrate ok');
});

it('closes the slides even when calibration cannot run at all, so the panel stays usable, and setup is not done', async () => {
  const { log, view, deps } = harness();
  deps.calibrate = async () => { throw new Error('eye tracking failed to start'); };
  await expect(runSetup(view, deps)).rejects.toThrow('eye tracking failed to start');
  expect(log.at(-1)).toBe('close');
  expect(log).not.toContain('done');
});

it('later openings: no intro or farewell, and only a missing step comes back', async () => {
  const ready = harness({ done: true });
  expect(await runSetup(ready.view, ready.deps)).toEqual({ spoke: false });
  expect(ready.log).toEqual(['close']);

  const newScreen = harness({ done: true, calibrated: false }); // no calibration fits this screen, say a new monitor
  expect(await runSetup(newScreen.view, newScreen.deps)).toEqual({ spoke: false });
  expect(newScreen.log).toEqual(['show calibrate', 'say calibrate', 'calibrate ok', 'close']);

  const noCamera = harness({ done: true, camera: false });
  const run = runSetup(noCamera.view, noCamera.deps);
  await flush();
  expect(noCamera.log).toEqual(['ask camera', 'needs camera']);
  noCamera.grant({ camera: true });
  await run;
  expect(noCamera.log.at(-1)).toBe('close');
  expect(noCamera.log).not.toContain('show calibrate');
});
