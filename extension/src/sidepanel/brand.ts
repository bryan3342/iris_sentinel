// The Iris wordmark that heads the side panel. The dot of the "i" is an eye
// that blinks and glances, so the logo doubles as a small sign of life. It is
// drawn inline (not loaded from the SVG asset) so the stem can follow the
// panel's text colour in light and dark; the eye keeps its teal. The motion
// lives in panel.css and stops for prefers-reduced-motion.

/** The wordmark's markup. `gradient` names its gradient, which must be unique in the page. */
export const wordmark = (gradient: string) => `
  <span class="word">
    <span class="word__i">
      <svg viewBox="0 0 44 96" class="word__svg" aria-hidden="true">
        <defs>
          <linearGradient id="${gradient}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#36e0cc"/>
            <stop offset="1" stop-color="#0e9488"/>
          </linearGradient>
        </defs>
        <rect class="stem" x="15" y="40" width="15" height="44" rx="7.5" fill="currentColor"/>
        <g class="blink">
          <circle cx="22.5" cy="16" r="13" fill="none" stroke="url(#${gradient})" stroke-width="6.5"/>
          <g class="look">
            <circle cx="22.5" cy="16" r="5.6" fill="#1a6b60"/>
            <circle cx="18.8" cy="12.8" r="2.2" fill="#eafffb"/>
          </g>
        </g>
      </svg>
    </span><span class="word__rest">ris</span>
  </span>`;

/** The side panel's header: the animated Iris wordmark, labelled for screen readers. */
export function brandHeader(): HTMLElement {
  const header = document.createElement('header');
  header.className = 'brand';
  header.setAttribute('role', 'img');
  header.setAttribute('aria-label', 'Iris');
  header.innerHTML = wordmark('iris-grad');
  return header;
}
