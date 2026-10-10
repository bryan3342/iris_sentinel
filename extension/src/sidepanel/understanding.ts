import { PageCoordinator, broker } from '../page-understanding/coordinator';
import type { Operation } from '@iris/protocol';
import { gatewayUrl } from '../page-understanding/session';

export function understandingPanel(): HTMLElement {
  const panel = document.createElement('section'); panel.className = 'understanding';
  const title = document.createElement('h2'); title.textContent = 'Page understanding · private demo';
  const notice = document.createElement('p');
  notice.textContent = 'Only the visible viewport is examined. Each request sends a screenshot or image crop to Gemini. Detectable form fields are masked, but other private information may remain. Google’s data handling applies. Recommendations do not click.';
  const gateway = document.createElement('input'); gateway.type = 'url'; gateway.placeholder = 'Operator-provided gateway URL'; gateway.setAttribute('aria-label', 'Gateway URL');
  const request = document.createElement('input'); request.maxLength = 500; request.placeholder = 'What would you like to find?'; request.setAttribute('aria-label', 'Target description');
  const imageId = document.createElement('input'); imageId.type = 'number'; imageId.min = '1'; imageId.placeholder = 'Image number'; imageId.setAttribute('aria-label', 'Image number');
  const output = document.createElement('p'); output.setAttribute('role', 'status'); output.setAttribute('aria-live', 'polite');
  const session = document.createElement('input'); session.type = 'password'; session.autocomplete = 'off'; session.placeholder = 'Operator-issued demo token (15 minutes)'; session.setAttribute('aria-label', 'Demo session token');
  const coordinator = new PageCoordinator(); const buttons: HTMLButtonElement[] = [];
  const button = (label: string, action: () => Promise<void>) => {
    const el = document.createElement('button'); el.textContent = label; buttons.push(el);
    el.addEventListener('click', () => {
      buttons.forEach(b => { b.disabled = true; }); output.textContent = 'Working…';
      void action().catch(error => {
        const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'REQUEST_FAILED';
        output.textContent = `${code}. Allow Iris on all websites, or invoke Iris on the current tab, and use a provisioned gateway. No automatic retry.`;
      }).finally(() => buttons.forEach(b => { b.disabled = false; }));
    });
    return el;
  };
  const inspect = async (operation: Operation) => {
    const response = await coordinator.inspect({ gateway: gateway.value, operation, request: request.value, imageId: Number(imageId.value) });
    const result = response.result.result;
    output.textContent = result.operation === 'find_target' ? `${result.targetId === null ? 'No clear match.' : `Recommended target ${result.targetId}.${response.highlighted ? ' It is highlighted on the page.' : ''} Iris confirmation is required before any future click.`} ${result.explanation}${response.targetsTruncated ? ' Target list was limited to 100.' : ''}`
      : result.operation === 'summarize_page' ? result.summary : `Visible image crop ${result.imageId}: ${result.description}`;
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
  button('Send viewport to summarize', () => inspect('summarize_page')),
  button('List visible image numbers', async () => {
    const images = await coordinator.images(); output.textContent = images.length ? `Visible image numbers: ${images.map(i => i.id).join(', ')}` : 'No visible images.';
  }), imageId, button('Send image crop to describe', () => inspect('describe_image')), cancel, output);
  addEventListener('pagehide', () => coordinator.cancel(), { once: true });
  return panel;
}
