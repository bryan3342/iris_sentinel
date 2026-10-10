import type { NumberedTarget } from '@iris/protocol';

export type OverlayCommand =
  | { type: 'show'; documentToken: string; revision: number; targets: NumberedTarget[]; highlight: number | null }
  | { type: 'clear' };
export type OverlayResult = 'SHOWN' | 'STALE' | 'CLEARED';

/**
 * Draws target numbers and one highlight over the page. Runs in Chrome's
 * isolated world and must remain self-contained for executeScript. It only
 * draws: no clicks, focus or scrolling, and pointer events pass straight
 * through. The host is a plain div with a closed shadow root, mounted once and
 * redrawn only inside that root, so the page helper never counts a redraw as a
 * page change. A drawing is bound to one document revision and is erased by
 * the next page change.
 */
export async function pageOverlay(command: OverlayCommand): Promise<OverlayResult> {
  type Understanding = { documentToken: string; revision: number; onChange?: () => void };
  type Overlay = { host: HTMLDivElement; layer: HTMLDivElement };
  const host = globalThis as typeof globalThis & { __irisUnderstandingV01?: Understanding; __irisOverlayV01?: Overlay };
  const clear = () => {
    const drawn = Boolean(host.__irisOverlayV01?.layer.firstChild);
    host.__irisOverlayV01?.layer.replaceChildren();
    return drawn;
  };
  if (command.type === 'clear') {
    // Wait until the erased overlay has been painted, so a screenshot taken next never contains it.
    // A tab that is not visible never paints, so the wait is capped instead of hanging.
    if (clear()) {
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
        setTimeout(resolve, 100);
      });
    }
    return 'CLEARED';
  }
  const state = host.__irisUnderstandingV01;
  if (!state || state.documentToken !== command.documentToken || state.revision !== command.revision) {
    clear();
    return 'STALE';
  }
  if (!host.__irisOverlayV01) {
    const element = document.createElement('div');
    element.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;contain:strict';
    const root = element.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    // No transitions or animations: the page helper treats those as page changes.
    style.textContent = `
      .badge { position: fixed; padding: 0 4px; font: bold 13px/18px sans-serif; color: #000;
        background: #ffeb3b; border: 1px solid #000; border-radius: 3px; }
      .badge.aimed { font-size: 16px; line-height: 22px; background: #fff; }
      .aim { position: fixed; box-sizing: border-box; border: 4px solid #000; outline: 3px solid #ffeb3b; }`;
    const layer = document.createElement('div');
    root.append(style, layer);
    host.__irisOverlayV01 = { host: element, layer };
    document.documentElement.append(element);
  }
  const vv = visualViewport;
  const left = (x: number) => `${x + (vv?.offsetLeft ?? 0)}px`;
  const top = (y: number) => `${y + (vv?.offsetTop ?? 0)}px`;
  const drawing: HTMLElement[] = [], aim: HTMLElement[] = [];
  for (const target of command.targets) {
    const aimed = target.id === command.highlight;
    if (aimed) {
      const box = document.createElement('div');
      box.className = 'aim';
      Object.assign(box.style, { left: left(target.rect.x), top: top(target.rect.y), width: `${target.rect.width}px`, height: `${target.rect.height}px` });
      aim.push(box);
    }
    const badge = document.createElement('div');
    badge.className = aimed ? 'badge aimed' : 'badge';
    badge.textContent = String(target.id);
    Object.assign(badge.style, { left: left(target.rect.x), top: top(target.rect.y) });
    (aimed ? aim : drawing).push(badge);
  }
  // The aimed target is drawn last so neighboring badges never cover it.
  host.__irisOverlayV01.layer.replaceChildren(...drawing, ...aim);
  state.onChange = clear;
  return 'SHOWN';
}
