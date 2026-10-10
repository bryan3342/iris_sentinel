import { pageOverlay } from '../content/overlay';
import type { LiveTargetList, TargetList } from './target-list';

function draw(list: TargetList): void {
  void chrome.scripting.executeScript({
    target: { tabId: list.tabId },
    func: pageOverlay,
    args: [{ type: 'show', documentToken: list.documentToken, revision: list.revision, targets: list.targets, highlight: null }],
  }).catch(() => {}); // the next refresh draws again
}

function erase(tabId: number): void {
  void chrome.scripting.executeScript({ target: { tabId }, func: pageOverlay, args: [{ type: 'clear' }] }).catch(() => {});
}

/** Side panel switch that keeps every target's number drawn on the page, refreshed as the page changes. */
export function numbersPanel(targets: LiveTargetList): HTMLElement {
  const label = document.createElement('label');
  label.className = 'numbers-toggle';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  label.append(toggle, ' Show numbers on the page');
  let stopDrawing: (() => void) | null = null;
  let drawnTab: number | null = null;
  toggle.addEventListener('change', () => {
    if (toggle.checked) {
      stopDrawing = targets.onChange((list) => {
        // Moving to another tab leaves no numbers behind on the previous one.
        if (drawnTab !== null && drawnTab !== list?.tabId) erase(drawnTab);
        drawnTab = list?.tabId ?? null;
        if (list) draw(list);
      });
      targets.start();
      return;
    }
    stopDrawing?.();
    stopDrawing = null;
    targets.stop();
    if (drawnTab !== null) erase(drawnTab);
    drawnTab = null;
  });
  return label;
}
