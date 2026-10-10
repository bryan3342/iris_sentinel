import type { NumberedTarget, Point2 } from '@iris/protocol';

export type OverlayCommand =
  | { type: 'show'; documentToken: string; revision: number; targets: NumberedTarget[]; highlight: number | null; pending?: number | null }
  | { type: 'clear' }
  | { type: 'hold' }
  | { type: 'release' }
  | { type: 'dot'; at: Point2 | null }
  | { type: 'listen' };
export type OverlayResult = 'SHOWN' | 'STALE' | 'CLEARED' | 'HELD';
/** The connection over which the side panel streams the live gaze point to the page. */
export const GAZE_CURSOR_PORT = 'iris.gaze-cursor';

/**
 * Draws target numbers and one highlight over the page. Runs in Chrome's
 * isolated world and must remain self-contained for executeScript. It only
 * draws: no clicks, focus or scrolling, and pointer events pass straight
 * through. The host is a plain div with a closed shadow root, mounted once and
 * redrawn only inside that root, so the page helper never counts a redraw as a
 * page change. A drawing is bound to one document revision and is erased by
 * the next page change. For calibration it instead shows one still dot over a
 * dimmed page, at a fraction of the visible viewport. A hold clears the page and
 * refuses every 'show' until released, so a screenshot never contains numbers drawn
 * by another part of Iris (gaze keeps redrawing while it aims).
 *
 * 'listen' starts the live gaze cursor: a red ring that follows the user's gaze,
 * moved over a connection from the side panel instead of one injection per frame.
 * It lives in the same closed shadow root, so page scripts cannot read where the
 * user looks, and it hides for a screenshot, when the eyes close, and when the
 * side panel disconnects.
 */
export async function pageOverlay(command: OverlayCommand): Promise<OverlayResult> {
  type Understanding = { documentToken: string; revision: number; onChange?: () => void };
  type Overlay = { host: HTMLDivElement; layer: HTMLDivElement; cursor: HTMLDivElement; listening?: boolean };
  const host = globalThis as typeof globalThis & { __irisUnderstandingV01?: Understanding; __irisOverlayV01?: Overlay; __irisOverlayHoldV01?: number };
  const STYLE = `
      .badge { position: fixed; padding: 0 4px; font: bold 13px/18px sans-serif; color: #000;
        background: #ffeb3b; border: 1px solid #000; border-radius: 3px; }
      .badge.aimed { font-size: 16px; line-height: 22px; background: #fff; }
      .aim { position: fixed; box-sizing: border-box; border: 4px solid #000; outline: 3px solid #ffeb3b; }
      .aim.again { border: 4px dashed #b00020; outline-color: #fff; }
      .again-note { position: fixed; padding: 2px 6px; font: bold 13px/18px sans-serif; color: #fff; background: #b00020; border-radius: 3px; }
      .shade { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); }
      .dot { position: fixed; width: 24px; height: 24px; margin: -12px 0 0 -12px; border-radius: 50%;
        background: #2dd4bf; border: 3px solid #fff; }
      .cursor { position: fixed; left: -24px; top: -24px; width: 48px; height: 48px; box-sizing: border-box;
        border: 4px solid #ff2828; box-shadow: 0 0 12px #ff2828; border-radius: 50%; }`;
  const held = () => (host.__irisOverlayHoldV01 ?? 0) > Date.now();
  const clear = () => {
    const overlay = host.__irisOverlayV01;
    const drawn = Boolean(overlay && (overlay.layer.firstChild || !overlay.cursor.hidden));
    overlay?.layer.replaceChildren();
    if (overlay) overlay.cursor.hidden = true;
    return drawn;
  };
  const mount = (): Overlay => {
    if (host.__irisOverlayV01) return host.__irisOverlayV01;
    const element = document.createElement('div');
    element.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;contain:strict';
    const root = element.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    // No transitions or animations: the page helper treats those as page changes.
    style.textContent = STYLE;
    const layer = document.createElement('div');
    const cursor = document.createElement('div');
    cursor.className = 'cursor';
    cursor.hidden = true;
    root.append(style, layer, cursor);
    host.__irisOverlayV01 = { host: element, layer, cursor };
    document.documentElement.append(element);
    return host.__irisOverlayV01;
  };
  if (command.type === 'release') {
    delete host.__irisOverlayHoldV01;
    return 'CLEARED';
  }
  if (command.type === 'clear' || command.type === 'hold') {
    // A hold lapses after 5 seconds on its own, in case the side panel closes before releasing it.
    if (command.type === 'hold') host.__irisOverlayHoldV01 = Date.now() + 5_000;
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
  if (command.type === 'listen') {
    const overlay = mount();
    if (!overlay.listening) {
      overlay.listening = true;
      chrome.runtime.onConnect.addListener((port) => {
        if (port.name !== 'iris.gaze-cursor') return; // GAZE_CURSOR_PORT; self-contained for executeScript
        port.onMessage.addListener((message: unknown) => {
          const at = (message as { at?: { x?: unknown; y?: unknown } | null } | null)?.at;
          const valid = !!at && typeof at.x === 'number' && typeof at.y === 'number' && Number.isFinite(at.x) && Number.isFinite(at.y);
          overlay.cursor.hidden = !valid || held();
          if (valid && !held()) {
            const vv = visualViewport;
            overlay.cursor.style.transform = `translate(${(at.x as number) + (vv?.offsetLeft ?? 0)}px, ${(at.y as number) + (vv?.offsetTop ?? 0)}px)`;
          }
        });
        port.onDisconnect.addListener(() => { overlay.cursor.hidden = true; });
      });
    }
    return 'SHOWN';
  }
  if (command.type === 'show' && held()) return 'HELD';
  const state = host.__irisUnderstandingV01;
  if (command.type === 'show' && (!state || state.documentToken !== command.documentToken || state.revision !== command.revision)) {
    clear();
    return 'STALE';
  }
  const overlay = mount();
  if (command.type === 'dot') {
    if (state) state.onChange = undefined; // a page change must not erase a calibration dot
    if (!command.at) {
      overlay.layer.replaceChildren();
      return 'CLEARED';
    }
    const shade = document.createElement('div');
    shade.className = 'shade';
    const dot = document.createElement('div');
    dot.className = 'dot';
    Object.assign(dot.style, { left: `${command.at.x * 100}%`, top: `${command.at.y * 100}%` });
    overlay.layer.replaceChildren(shade, dot);
    return 'SHOWN';
  }
  const vv = visualViewport;
  const left = (x: number) => `${x + (vv?.offsetLeft ?? 0)}px`;
  const top = (y: number) => `${y + (vv?.offsetTop ?? 0)}px`;
  const drawing: HTMLElement[] = [], aim: HTMLElement[] = [];
  for (const target of command.targets) {
    const aimed = target.id === command.highlight;
    const waiting = target.id === command.pending; // a risky target waiting for its second confirm
    if (aimed || waiting) {
      const box = document.createElement('div');
      box.className = waiting ? 'aim again' : 'aim';
      Object.assign(box.style, { left: left(target.rect.x), top: top(target.rect.y), width: `${target.rect.width}px`, height: `${target.rect.height}px` });
      aim.push(box);
    }
    if (waiting) {
      const note = document.createElement('div');
      note.className = 'again-note';
      note.textContent = 'Look away and back to confirm';
      Object.assign(note.style, { left: left(target.rect.x), top: top(target.rect.y + target.rect.height + 4) });
      aim.push(note);
    }
    const badge = document.createElement('div');
    badge.className = aimed ? 'badge aimed' : 'badge';
    badge.textContent = String(target.id);
    Object.assign(badge.style, { left: left(target.rect.x), top: top(target.rect.y) });
    (aimed ? aim : drawing).push(badge);
  }
  // The aimed target is drawn last so neighboring badges never cover it.
  overlay.layer.replaceChildren(...drawing, ...aim);
  state!.onChange = clear; // checked above: show requires the scanned document and revision
  return 'SHOWN';
}
