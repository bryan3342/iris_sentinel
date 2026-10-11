import { VOICE_LINES } from '../agent/voice-lines';
import { wordmark } from '../brand';
import { CALIBRATE, DONE, INTRO, type SetupView, type Slide } from './first-run';

const SLIDES: readonly Slide[] = [...INTRO, CALIBRATE, DONE];

// Simple pictures, drawn inline so their lines follow the panel's light or dark text color.
const PICTURES: Record<Slide['picture'] | 'access', string> = {
  logo: `<div class="brand">${wordmark('iris-setup-grad')}</div>`, // the brand styles size the wordmark and blink its eye
  eye: `<svg viewBox="0 0 120 120" aria-hidden="true">
    <path d="M10 56 Q60 14 110 56 Q60 98 10 56Z" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>
    <circle cx="60" cy="56" r="16" fill="#0e9488"/>
    <rect x="74" y="80" width="38" height="28" rx="5" fill="#ffeb3b" stroke="#000" stroke-width="2"/>
    <text x="93" y="100" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="700" font-size="18" fill="#000">12</text>
  </svg>`,
  tilt: `<svg viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="50" cy="44" r="20" fill="none" stroke="currentColor" stroke-width="6" transform="rotate(16 50 68)"/>
    <path d="M18 104 Q50 72 82 104" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
    <path d="M102 24 V96" stroke="#0e9488" stroke-width="6" stroke-linecap="round"/>
    <path d="M92 34 L102 22 L112 34 M92 86 L102 98 L112 86" fill="none" stroke="#0e9488" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  voice: `<svg viewBox="0 0 120 120" aria-hidden="true">
    <path d="M16 22 H104 a8 8 0 0 1 8 8 V76 a8 8 0 0 1 -8 8 H48 L28 102 V84 H16 a8 8 0 0 1 -8 -8 V30 a8 8 0 0 1 8 -8Z"
      fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>
    <circle cx="38" cy="53" r="6" fill="#0e9488"/><circle cx="60" cy="53" r="6" fill="#0e9488"/><circle cx="82" cy="53" r="6" fill="#0e9488"/>
  </svg>`,
  dot: `<svg viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="44" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="6 8"/>
    <circle cx="60" cy="60" r="16" fill="#2dd4bf" stroke="#fff" stroke-width="5"/>
  </svg>`,
  done: `<svg viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="46" fill="none" stroke="#0e9488" stroke-width="6"/>
    <path d="M38 62 L54 78 L84 44" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  access: `<svg viewBox="0 0 120 120" aria-hidden="true">
    <rect x="14" y="36" width="70" height="52" rx="8" fill="none" stroke="currentColor" stroke-width="6"/>
    <path d="M84 52 L106 40 V84 L84 72Z" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>
    <circle cx="49" cy="62" r="11" fill="#0e9488"/>
  </svg>`,
};

/** What still needs allowing, in a sentence. */
function missingText(missing: { camera: boolean; websites: boolean }): string {
  if (missing.camera && missing.websites) return 'Allow the camera in the tab Iris opened, then allow Iris on all websites.';
  if (missing.camera) return 'Allow the camera in the tab Iris opened.';
  return 'Allow Iris on all websites, so it can show numbers and calibrate on any page.';
}

/**
 * The setup slideshow over the side panel: a picture, a title and the line Iris says, shown as a
 * caption for anyone who cannot hear it, with dots for how far along setup is. When access is missing
 * it says what to allow, with a button for website access, which Chrome grants only from a click.
 * Nothing shows until there is something to show, or until `cover` puts it up blank, and closing removes it.
 */
export function slidesView(root: HTMLElement): SetupView & { cover(): void } {
  const overlay = document.createElement('div');
  overlay.className = 'setup';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Iris setup');
  const picture = document.createElement('div');
  picture.className = 'picture';
  const title = document.createElement('h2');
  const caption = document.createElement('p');
  caption.className = 'caption';
  caption.setAttribute('aria-live', 'polite');
  const button = document.createElement('button');
  button.textContent = 'Allow Iris on all websites';
  button.hidden = true;
  let allow: (() => void) | null = null;
  button.addEventListener('click', () => allow?.());
  const progress = document.createElement('ol');
  progress.className = 'progress';
  progress.setAttribute('aria-hidden', 'true');
  const steps = SLIDES.map(() => progress.appendChild(document.createElement('li')));

  const draw = (art: string, heading: string, text: string, at: number) => {
    if (!overlay.isConnected) root.append(overlay);
    if (!overlay.hasChildNodes()) overlay.append(picture, title, caption, button, progress);
    picture.innerHTML = art;
    title.textContent = heading;
    caption.textContent = text;
    steps.forEach((step, i) => step.classList.toggle('now', i === at));
  };
  return {
    /** Puts the overlay up blank right away, before anything is painted, so the panel never shows before setup does. */
    cover() {
      if (!overlay.isConnected) root.append(overlay);
    },
    show(slide) {
      button.hidden = true;
      draw(PICTURES[slide.picture], slide.title, VOICE_LINES[slide.line], SLIDES.findIndex((s) => s.line === slide.line));
    },
    needs(missing, allowWebsites) {
      allow = allowWebsites;
      button.hidden = !missing.websites;
      draw(PICTURES.access, 'Allow access', missingText(missing), -1);
    },
    close() {
      overlay.remove();
    },
  };
}
