import { wordmark } from './brand';

// The first time Iris is ever opened, the side panel opens on a short animation:
// the eye appears in the middle and blinks, then the rest of the word pulls out
// of it to the right until the whole wordmark is centered, and it fades away.
// The spoken intro follows. The motion lives in panel.css; with reduced motion
// the wordmark simply shows for a moment.

const SHOWN_KEY = 'iris.splashShown';
/** Longest the animation can take; also the fallback when animations do not run (a hidden panel). */
const LONGEST_MS = 3_500;
const STILL_MS = 1_000;

/** Plays the opening animation over `root` on the first opening ever; resolves when it is over (at once otherwise). */
export async function firstOpenSplash(root: HTMLElement): Promise<void> {
  let shown = true;
  try { shown = (await chrome.storage.local.get(SHOWN_KEY))[SHOWN_KEY] === true; } catch { /* no storage: skip */ }
  if (shown) return;
  const splash = document.createElement('div');
  splash.className = 'brand splash';
  splash.setAttribute('role', 'img');
  splash.setAttribute('aria-label', 'Iris');
  splash.innerHTML = wordmark('iris-splash-grad');
  root.append(splash);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  await new Promise<void>((done) => {
    const timer = setTimeout(done, still ? STILL_MS : LONGEST_MS);
    splash.addEventListener('animationend', (event) => {
      if (event.animationName === 'splash-out') { clearTimeout(timer); done(); }
    });
  });
  splash.remove();
  await chrome.storage.local.set({ [SHOWN_KEY]: true }).catch(() => {});
}
