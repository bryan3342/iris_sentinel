import { PageCoordinator, type AimedTarget } from '../page-understanding/coordinator';
import type { Operation } from '@iris/protocol';
import type { PageMarks } from './page-marks';

const SETUP = 'The Iris server is not set up for this. Check server/.dev.vars against the Gemini runbook, then restart the server.';
const CHANGED = 'The page changed or the request was cancelled, so any result was discarded.';
/** What each failure means for the person using the panel. The code stays visible for the runbook's troubleshooting table. */
const HINTS: Record<string, string> = {
  REQUEST_FAILED: 'The Iris server is not running. In a terminal: cd server, then npm run dev.',
  UNAUTHENTICATED: SETUP,
  PAGE_NOT_ALLOWED: 'Use an ordinary web page in the focused window, and allow Iris on it.',
  UNSUPPORTED_PAGE: 'This page cannot be captured safely: it is zoomed, very large, or has video or embedded frames.',
  PAGE_CHANGED: CHANGED, PAGE_CHANGED_OR_CANCELLED: CHANGED, CANCELLED_OR_TIMEOUT: 'The request timed out or was cancelled.',
  TIMEOUT: 'The request timed out.', REQUEST_IN_FLIGHT: 'A request is already running.',
  RATE_LIMITED: 'Iris allows ten requests a minute. Wait a moment, then try again.',
  NO_TARGETS: 'No links or buttons are visible on this page.',
  NO_AIMED_TARGET: 'Rest your eyes, or the mouse, on a numbered target for a moment first.',
  LIST_IMAGES_FIRST: 'List the visible image numbers first.', IMAGE_NOT_FOUND: 'No visible image has that number.',
  DISABLED: SETUP, NOT_CONFIGURED: SETUP, CONTENT_NOT_APPROVED: SETUP, FORBIDDEN: SETUP,
  UPSTREAM_UNAVAILABLE: 'Gemini is busy or over quota. Wait, then try again.',
  UPSTREAM_REJECTED: 'Gemini refused the request. Check GEMINI_API_KEY and GEMINI_MODEL in server/.dev.vars.',
  INVALID_MODEL_RESULT: 'Gemini returned an answer Iris could not use.',
};

export function understandingPanel(marks: PageMarks): HTMLElement {
  const panel = document.createElement('section'); panel.className = 'understanding';
  const title = document.createElement('h2'); title.textContent = 'Page understanding';
  const notice = document.createElement('p');
  notice.textContent = 'Only the visible viewport is examined. Each request sends a screenshot or image crop to Gemini. Detectable form fields are masked, but other private information may remain. Google’s data handling applies. Recommendations do not click.';
  const request = document.createElement('input'); request.maxLength = 500; request.placeholder = 'What would you like to find?'; request.setAttribute('aria-label', 'Target description');
  const imageId = document.createElement('input'); imageId.type = 'number'; imageId.min = '1'; imageId.placeholder = 'Image number'; imageId.setAttribute('aria-label', 'Image number');
  const output = document.createElement('p'); output.setAttribute('role', 'status'); output.setAttribute('aria-live', 'polite');
  const coordinator = new PageCoordinator({ afterCapture: () => marks.redraw() }); const buttons: HTMLButtonElement[] = [];
  const button = (label: string, action: () => Promise<void>) => {
    const el = document.createElement('button'); el.textContent = label; buttons.push(el);
    el.addEventListener('click', () => {
      buttons.forEach(b => { b.disabled = true; }); output.textContent = 'Working…';
      void action().catch(error => {
        const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'REQUEST_FAILED';
        output.textContent = `${code}. ${HINTS[code] ?? HINTS.REQUEST_FAILED} No automatic retry.`;
      }).finally(() => buttons.forEach(b => { b.disabled = false; }));
    });
    return el;
  };
  const inspect = async (operation: Operation, aimed?: AimedTarget | null) => {
    const response = await coordinator.inspect({ operation, request: request.value, imageId: Number(imageId.value), aimed });
    const result = response.result.result;
    output.textContent = result.operation === 'find_target' ? `${result.targetId === null ? 'No clear match.' : `Recommended target ${result.targetId}.${response.highlighted ? ' It is highlighted on the page.' : ''} Iris confirmation is required before any future click.`} ${result.explanation}${response.targetsTruncated ? ' Target list was limited to 100.' : ''}`
      : result.operation === 'summarize_page' ? result.summary
      : result.operation === 'describe_target' ? `Target ${result.targetId}: ${result.description}`
      : `Visible image crop ${result.imageId}: ${result.description}`;
  };
  const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => coordinator.cancel());
  panel.append(title, notice, request,
  button('Send viewport to find target', () => inspect('find_target')),
  // The target gaze rested on, not one it passed over while reaching for this button.
  button('What is this? (the target I rested on)', () => {
    const aimed = marks.aimed;
    return inspect('describe_target', aimed && { documentToken: aimed.list.documentToken, id: aimed.target.id, rect: aimed.target.rect });
  }),
  button('Send viewport to summarize', () => inspect('summarize_page')),
  button('List visible image numbers', async () => {
    const images = await coordinator.images(); output.textContent = images.length ? `Visible image numbers: ${images.map(i => i.id).join(', ')}` : 'No visible images.';
  }), imageId, button('Send image crop to describe', () => inspect('describe_image')), cancel, output);
  addEventListener('pagehide', () => coordinator.cancel(), { once: true });
  return panel;
}
