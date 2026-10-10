import type { AimedTarget, PageCoordinator } from '../page-understanding/coordinator';
import type { Operation } from '@iris/protocol';
import { describeFailure, failureCode } from './failures';
import type { PageMarks } from './page-marks';


export function understandingPanel(marks: PageMarks, coordinator: PageCoordinator): HTMLElement {
  const panel = document.createElement('section'); panel.className = 'understanding';
  const title = document.createElement('h2'); title.textContent = 'Page understanding';
  const notice = document.createElement('p');
  notice.textContent = 'Only the visible viewport is examined. Each request sends a screenshot or image crop to Gemini. Detectable form fields are masked, but other private information may remain. Google’s data handling applies. Recommendations do not click.';
  const request = document.createElement('input'); request.maxLength = 500; request.placeholder = 'What would you like to find?'; request.setAttribute('aria-label', 'Target description');
  const imageId = document.createElement('input'); imageId.type = 'number'; imageId.min = '1'; imageId.placeholder = 'Image number'; imageId.setAttribute('aria-label', 'Image number');
  const output = document.createElement('p'); output.setAttribute('role', 'status'); output.setAttribute('aria-live', 'polite');
  const buttons: HTMLButtonElement[] = [];
  const button = (label: string, action: () => Promise<void>) => {
    const el = document.createElement('button'); el.textContent = label; buttons.push(el);
    el.addEventListener('click', () => {
      buttons.forEach(b => { b.disabled = true; }); output.textContent = 'Working…';
      void action().catch(error => {
        output.textContent = `${describeFailure(failureCode(error))} No automatic retry.`;
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
