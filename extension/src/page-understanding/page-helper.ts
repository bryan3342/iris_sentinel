import type { NumberedTarget, Rect, Viewport } from '@iris/protocol';
export interface PageSnapshot {
  documentToken: string; revision: number; viewport: Viewport;
  targets: NumberedTarget[]; targetsTruncated: boolean;
  images: { id: number; rect: Rect }[]; masks: Rect[]; blocked: boolean;
}

/** Runs in Chrome's isolated world. Must remain self-contained for executeScript. */
export function pageSnapshot(): PageSnapshot {
  // onChange is set by Iris's own overlay (content/overlay.ts) to erase its drawing on the next page change.
  type State = { documentToken: string; revision: number; onChange?: () => void };
  const host = globalThis as typeof globalThis & { __irisUnderstandingV01?: State; __irisOverlayV01?: { host: Element } };
  const overlay = () => host.__irisOverlayV01?.host;
  if (!host.__irisUnderstandingV01) {
    const state: State = { documentToken: crypto.randomUUID(), revision: 0 };
    host.__irisUnderstandingV01 = state;
    const change = () => {
      state.revision++;
      const notify = state.onChange; state.onChange = undefined; notify?.();
    };
    // Mounting the overlay is Iris's own change, not the page's. Redraws happen inside its shadow root, which is not observed.
    const ours = (r: MutationRecord) => r.target === overlay() ||
      (r.type === 'childList' && r.addedNodes.length + r.removedNodes.length > 0 && [...r.addedNodes, ...r.removedNodes].every(n => n === overlay()));
    new MutationObserver(records => { if (!records.every(ours)) change(); }).observe(document.documentElement, { subtree: true, attributes: true, characterData: true, childList: true });
    new ResizeObserver(change).observe(document.documentElement);
    for (const event of ['scroll', 'resize', 'input', 'change', 'load', 'transitionrun', 'animationstart']) addEventListener(event, change, true);
    visualViewport?.addEventListener('scroll', change);
    visualViewport?.addEventListener('resize', change);
    document.fonts?.addEventListener('loadingdone', change);
  }
  const state = host.__irisUnderstandingV01;
  const vv = visualViewport;
  const viewport: Viewport = { width: vv?.width ?? innerWidth, height: vv?.height ?? innerHeight,
    offsetLeft: vv?.offsetLeft ?? 0, offsetTop: vv?.offsetTop ?? 0,
    scale: vv?.scale ?? 1, scrollX, scrollY };
  const targets: NumberedTarget[] = [], masks: Rect[] = [], images: { id: number; rect: Rect }[] = [];
  let blocked = viewport.scale !== 1, targetsTruncated = false, nextTarget = 1, nextImage = 1, scanned = 0;
  const rectOf = (el: Element, padding = 0): Rect | undefined => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return;
    const b = el.getBoundingClientRect();
    const x = Math.max(0, b.left - viewport.offsetLeft - padding), y = Math.max(0, b.top - viewport.offsetTop - padding);
    const right = Math.min(viewport.width, b.right - viewport.offsetLeft + padding), bottom = Math.min(viewport.height, b.bottom - viewport.offsetTop + padding);
    if (right <= x || bottom <= y) return;
    return { x, y, width: right - x, height: bottom - y };
  };
  const walk = (root: Document | ShadowRoot) => {
    // Bound local traversal too; never silently miss sensitive fields on oversized pages.
    const elements = root.querySelectorAll('*');
    scanned += elements.length;
    if (scanned > 10_000) { blocked = true; return; }
    for (const el of elements) {
      if (el === overlay()) continue;
      const rect = rectOf(el);
      if (!rect) continue;
      if (el.shadowRoot) walk(el.shadowRoot);
      else if (el.localName.includes('-')) blocked = true; // inaccessible custom-control internals
      if (el.matches('iframe, frame, object, embed, video') || el.getAnimations().some(a => a.playState === 'running')) blocked = true;
      if (el.matches('input:not([type=hidden]), textarea, select, [contenteditable]:not([contenteditable=false]), [role=textbox], [role=combobox]')) {
        const mask = rectOf(el, 8); if (mask) masks.push(mask);
        continue;
      }
      if (el.matches('img') && images.length < 100) images.push({ id: nextImage++, rect });
      const role = el.matches('a[href], [role=link]') ? 'link' : el.matches('button, [role=button]') ? 'button' : undefined;
      if (!role || el.matches(':disabled, [aria-disabled=true]')) continue;
      const centerX = rect.x + rect.width / 2 + viewport.offsetLeft, centerY = rect.y + rect.height / 2 + viewport.offsetTop;
      const top = root.elementFromPoint(centerX, centerY);
      if (!top || !(el === top || el.contains(top))) continue;
      if (targets.length >= 100) { targetsTruncated = true; continue; }
      // Avoid nested editable values and text derived from sensitive descendants.
      const label = (el.getAttribute('aria-label') || (!el.querySelector('input, textarea, [contenteditable], select') ? el.textContent : '') || '').trim().slice(0, 200);
      targets.push({ id: nextTarget++, role, rect, ...(label ? { label } : {}) });
    }
  };
  walk(document);
  if (masks.length > 1000) blocked = true;
  return { documentToken: state.documentToken, revision: state.revision, viewport, targets, targetsTruncated, images, masks, blocked };
}
