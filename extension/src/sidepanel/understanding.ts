import { PageCoordinator, broker, type AimedTarget } from '../page-understanding/coordinator';
import type { Operation } from '@iris/protocol';
import { gatewayUrl } from '../page-understanding/session';
import type { PageMarks } from './page-marks';

const SETUP = 'The gateway is not set up for this request. See the troubleshooting table in the Gemini runbook.';
const SESSION = 'Enter a current demo session token, then try again.';
const CHANGED = 'The page changed or the request was cancelled, so any result was discarded.';
/** What each failure means for the person using the panel. The code stays visible for the runbook's troubleshooting table. */
const HINTS: Record<string, string> = {
  REQUEST_FAILED: 'Check that the gateway is running and Iris has gateway access.',
  INVALID_GATEWAY: 'Enter the gateway as an address such as http://127.0.0.1:8787.',
  INVALID_SESSION: 'That token is not in the expected format.',
  DEMO_SESSION_REQUIRED: SESSION, UNAUTHENTICATED: SESSION,
  PAGE_NOT_ALLOWED: 'Use an ordinary web page in the focused window, and allow Iris on it.',
  UNSUPPORTED_PAGE: 'This page cannot be captured safely: it is zoomed, very large, or has video or embedded frames.',
  PAGE_CHANGED: CHANGED, PAGE_CHANGED_OR_CANCELLED: CHANGED, CANCELLED_OR_TIMEOUT: 'The request timed out or was cancelled.',
  TIMEOUT: 'The request timed out.', REQUEST_IN_FLIGHT: 'A request is already running.',
  RATE_LIMITED: 'This session allows two requests a minute and ten in total. Wait a minute, or use a new token.',
  NO_TARGETS: 'No links or buttons are visible on this page.',
  NO_AIMED_TARGET: 'Rest your eyes, or the mouse stand-in, on a numbered target for a moment first.',
  LIST_IMAGES_FIRST: 'List the visible image numbers first.', IMAGE_NOT_FOUND: 'No visible image has that number.',
  DISABLED: SETUP, NOT_CONFIGURED: SETUP, CONTENT_NOT_APPROVED: SETUP, FORBIDDEN: SETUP,
  UPSTREAM_UNAVAILABLE: 'Gemini is busy or over quota. Wait, then try again.',
  UPSTREAM_REJECTED: 'Gemini refused the request. Check the key and model on the gateway.',
  INVALID_MODEL_RESULT: 'Gemini returned an answer Iris could not use.',
};

export function understandingPanel(marks: PageMarks): HTMLElement {
  const panel = document.createElement('section'); panel.className = 'understanding';
  const title = document.createElement('h2'); title.textContent = 'Page understanding · private demo';
  const notice = document.createElement('p');
  notice.textContent = 'Only the visible viewport is examined. Each request sends a screenshot or image crop to Gemini. Detectable form fields are masked, but other private information may remain. Google’s data handling applies. Recommendations do not click.';
  const gateway = document.createElement('input'); gateway.type = 'url'; gateway.placeholder = 'Operator-provided gateway URL'; gateway.setAttribute('aria-label', 'Gateway URL');
  const request = document.createElement('input'); request.maxLength = 500; request.placeholder = 'What would you like to find?'; request.setAttribute('aria-label', 'Target description');
  const imageId = document.createElement('input'); imageId.type = 'number'; imageId.min = '1'; imageId.placeholder = 'Image number'; imageId.setAttribute('aria-label', 'Image number');
  const output = document.createElement('p'); output.setAttribute('role', 'status'); output.setAttribute('aria-live', 'polite');
  const session = document.createElement('input'); session.type = 'password'; session.autocomplete = 'off'; session.placeholder = 'Operator-issued demo token (15 minutes)'; session.setAttribute('aria-label', 'Demo session token');
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
    const response = await coordinator.inspect({ gateway: gateway.value, operation, request: request.value, imageId: Number(imageId.value), aimed });
    const result = response.result.result;
    output.textContent = result.operation === 'find_target' ? `${result.targetId === null ? 'No clear match.' : `Recommended target ${result.targetId}.${response.highlighted ? ' It is highlighted on the page.' : ''} Iris confirmation is required before any future click.`} ${result.explanation}${response.targetsTruncated ? ' Target list was limited to 100.' : ''}`
      : result.operation === 'summarize_page' ? result.summary
      : result.operation === 'describe_target' ? `Target ${result.targetId}: ${result.description}`
      : `Visible image crop ${result.imageId}: ${result.description}`;
  };
  const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => coordinator.cancel());
  panel.append(title, notice, gateway, button('Allow gateway access', async () => {
    const origin = gatewayUrl(gateway.value);
    // Called directly from the button gesture, before other asynchronous work.
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    output.textContent = granted ? 'Gateway access allowed. Enter your operator-issued demo token next.' : 'Gateway access declined.';
  }), session, button('Use demo session', async () => {
    const sessionToken = session.value; session.value = '';
    await broker({ type: 'iris.page.session', gateway: gatewayUrl(gateway.value), sessionToken });
    output.textContent = 'Demo session entered. It stays in memory and expires on the server within 15 minutes.';
  }), request,
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
