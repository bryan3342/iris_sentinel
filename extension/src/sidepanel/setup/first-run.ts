import type { VoiceLine } from '../agent/voice-lines';

/** One slide of setup: the line Iris says while it shows (also its caption), a title and a picture. */
export interface Slide { line: VoiceLine; title: string; picture: 'logo' | 'eye' | 'tilt' | 'voice' | 'dot' | 'done' }

/** The intro, one slide per line Iris says; each slide stays until its line has played, so the two never drift apart. */
export const INTRO: readonly Slide[] = [
  { line: 'welcome', title: 'Browse hands-free', picture: 'logo' },
  { line: 'aim', title: 'Look, then blink twice', picture: 'eye' },
  { line: 'scroll', title: 'Tilt to scroll', picture: 'tilt' },
  { line: 'voice', title: 'Talk to Iris', picture: 'voice' },
];
export const CALIBRATE: Slide = { line: 'calibrate', title: 'Look at each dot', picture: 'dot' };
export const DONE: Slide = { line: 'enjoy', title: "You're ready", picture: 'done' };

/** Camera and website access: whether each is allowed. */
export interface Access { camera: boolean; websites: boolean }

/** What setup shows in the side panel. */
export interface SetupView {
  show(slide: Slide): void;
  /** Says what access is still missing; `allowWebsites` is for the website access button, which Chrome only honors from a click. */
  needs(missing: Access, allowWebsites: () => void): void;
  close(): void;
}

export interface SetupDeps {
  /** Plays one of Iris's fixed lines; settles once it has played, or could not. */
  say(line: VoiceLine): Promise<unknown>;
  access(): Promise<Access>;
  /** Calls `listener` whenever camera or website access changes; returns a function that stops it. */
  onAccessChange(listener: () => void): () => void;
  /** Opens Chrome's camera prompt in a tab of its own, since a side panel cannot show it. */
  askCamera(): void;
  /** Asks Chrome for access to websites. */
  askWebsites(): void;
  /** Whether a saved calibration fits this screen. */
  calibrated(): Promise<boolean>;
  /** Shows a website to calibrate over, waits for a steady face and runs the dots; true once a calibration is saved. */
  calibrate(): Promise<boolean>;
  /** Whether setup was ever completed, and recording that it now has been. */
  done(): Promise<boolean>;
  markDone(): Promise<void>;
}

/**
 * Setup in the side panel. The first time, Iris introduces itself over a slideshow, gets camera and
 * website access, and calibrates, so eye aiming always starts with a calibration; then it says
 * goodbye and setup counts as done. Closing the panel partway means it all runs again next time.
 * Later openings show only a step that has gone missing: access that was removed, or a calibration
 * for a screen Iris has not seen. Returns whether Iris spoke, so the panel does not greet again.
 */
export async function runSetup(view: SetupView, deps: SetupDeps): Promise<{ spoke: boolean }> {
  try {
    const firstRun = !(await deps.done());
    if (firstRun) {
      for (const slide of INTRO) {
        view.show(slide);
        await deps.say(slide.line);
      }
    }
    await allowed(view, deps);
    if (firstRun || !(await deps.calibrated())) {
      view.show(CALIBRATE);
      await deps.say(CALIBRATE.line);
      // A face lost from view or a page change stops the dots: they start again once all is ready.
      while (!(await deps.calibrate())) {
        await allowed(view, deps);
        view.show(CALIBRATE);
      }
    }
    if (firstRun) {
      view.show(DONE);
      await deps.say(DONE.line);
      await deps.markDone();
    }
    return { spoke: firstRun };
  } finally {
    view.close(); // even when something failed outright, so the panel underneath stays usable
  }
}

/** Resolves once camera and website access are both allowed, asking for whichever is missing. */
async function allowed(view: SetupView, deps: SetupDeps): Promise<void> {
  const access = await deps.access();
  if (access.camera && access.websites) return;
  if (!access.camera) deps.askCamera();
  await new Promise<void>((resolve) => {
    let finished = false;
    const check = async () => {
      const now = await deps.access();
      if (finished) return;
      if (now.camera && now.websites) {
        finished = true;
        stop();
        resolve();
        return;
      }
      view.needs({ camera: !now.camera, websites: !now.websites }, () => deps.askWebsites());
    };
    const stop = deps.onAccessChange(() => void check());
    void check();
  });
}
