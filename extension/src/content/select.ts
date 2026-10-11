import type { Rect } from '@iris/protocol';

export interface SelectCommand {
  documentToken: string;
  /** The gaze scan the target number came from. */
  revision: number;
  id: number;
  /** Where the user saw the target, in viewport pixels. */
  rect: Rect;
  /** True when the confirm was a double blink, the only confirm that opens a risky element. */
  blinked: boolean;
}
export type SelectResult = 'SELECTED' | 'STALE' | 'NEEDS_DOUBLE_BLINK';

/**
 * The one place Iris clicks. Runs in Chrome's isolated world and must remain
 * self-contained for executeScript. It clicks only the exact element behind
 * the confirmed target number in that gaze scan, and only if it is still on
 * the page, still where the user saw it and not covered. A risky element is
 * clicked only when the confirm was a double blink, checked here again in case
 * the side panel gets it wrong. Anything else returns without clicking.
 */
export function pageSelect(command: SelectCommand): SelectResult {
  type Scan = { revision: number; entries: { el: Element; risky: boolean }[] };
  type State = { documentToken: string; scans?: Scan[] };
  const state = (globalThis as typeof globalThis & { __irisUnderstandingV01?: State }).__irisUnderstandingV01;
  if (!state || state.documentToken !== command.documentToken) return 'STALE';
  const scan = [...(state.scans ?? [])].reverse().find((s) => s.revision === command.revision); // the latest such scan
  const entry = scan?.entries[command.id - 1];
  if (!entry || !entry.el.isConnected) return 'STALE';
  if (entry.risky && !command.blinked) return 'NEEDS_DOUBLE_BLINK';
  const vv = visualViewport;
  const b = entry.el.getBoundingClientRect();
  const left = Math.max(0, b.left - (vv?.offsetLeft ?? 0)), top = Math.max(0, b.top - (vv?.offsetTop ?? 0));
  const moved = Math.abs(left - command.rect.x) > 4 || Math.abs(top - command.rect.y) > 4;
  const cx = command.rect.x + command.rect.width / 2 + (vv?.offsetLeft ?? 0);
  const cy = command.rect.y + command.rect.height / 2 + (vv?.offsetTop ?? 0);
  const hit = (entry.el.getRootNode() as Document | ShadowRoot).elementFromPoint(cx, cy); // inside a shadow root too
  if (moved || !hit || !(hit === entry.el || entry.el.contains(hit))) return 'STALE';
  if (entry.el instanceof HTMLElement) entry.el.click();
  else entry.el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); // SVG links
  return 'SELECTED';
}
