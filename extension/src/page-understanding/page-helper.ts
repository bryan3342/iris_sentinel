import type { NumberedTarget, Rect, Viewport } from '@iris/protocol';
export interface PageSnapshot {
  documentToken: string; revision: number; viewport: Viewport;
  targets: NumberedTarget[]; targetsTruncated: boolean;
  images: { id: number; rect: Rect }[]; masks: Rect[]; blocked: boolean;
}
/**
 * Gaze's view of the page: target positions, plus whether selecting each one
 * needs a second confirm (missing counts as risky). Nothing here is sent off the device.
 */
export type PageTargets = Pick<PageSnapshot, 'documentToken' | 'revision' | 'viewport' | 'targetsTruncated'> & {
  targets: (NumberedTarget & { risky?: boolean })[];
};

/** Current document and change counter, or null before the first scan. Self-contained for executeScript. */
export function pageRevision(): { documentToken: string; revision: number } | null {
  const state = (globalThis as typeof globalThis & { __irisUnderstandingV01?: { documentToken: string; revision: number } }).__irisUnderstandingV01;
  return state ? { documentToken: state.documentToken, revision: state.revision } : null;
}

/**
 * Runs in Chrome's isolated world. Must remain self-contained for executeScript.
 * The default mode serves page understanding: it finds fields to mask and blocks
 * pages a screenshot cannot represent safely. The 'targets' mode serves gaze,
 * which sends nothing anywhere: it checks only links and buttons (role first,
 * before any layout work), applies none of the screenshot blocking rules, and
 * omits labels. Each target says whether selecting it is risky: only an
 * ordinary link to another page, or a plainly harmless button outside a form,
 * is safe. Anything that may submit, pay, delete or send, and anything Iris
 * cannot classify, is risky. The label is read here to decide and never returned.
 */
export function pageSnapshot(): PageSnapshot;
export function pageSnapshot(mode: 'targets'): PageTargets;
export function pageSnapshot(mode: 'understanding' | 'targets' = 'understanding'): PageSnapshot | PageTargets {
  const targetsOnly = mode === 'targets';
  const riskyWords = /\b(pay|buy|purchase|order|checkout|check out|delete|remove|send|submit|confirm|sign out|log ?out|unsubscribe|transfer|donate|subscribe|cancel|place)\b/i;
  const harmlessButton = /^(close|menu|next|previous|prev|back|more|less|expand|collapse|show|show more|show less|hide|open|play|pause)$/i;
  const risky = (el: Element, role: 'link' | 'button') => {
    const clean = (s: string | null) => (s ?? '').trim().replace(/\s+/g, ' ');
    const text = clean(el.getAttribute('aria-label') || el.textContent || el.getAttribute('title'));
    // Any name that sounds risky counts, even when another name is harmless.
    const names = [el.getAttribute('aria-label'), el.textContent, el.getAttribute('title')];
    if (el.closest('form') || names.some(n => riskyWords.test(clean(n)))) return true;
    if (role === 'button') return !harmlessButton.test(text);
    // Only a plain link to a web page: not a download, not script, mail, phone or another app.
    if (!(el instanceof HTMLAnchorElement) || !el.hasAttribute('href') || el.hasAttribute('download')) return true;
    try { return !/^https?:$/.test(new URL(el.href, location.href).protocol); } catch { return true; }
  };
  // onChange is set by Iris's own overlay (content/overlay.ts) to erase its drawing on the next page change.
  // scans keeps the elements behind the last few gaze scans, so a confirmed target number can be
  // selected exactly as it was scanned (content/select.ts). Elements never leave the page.
  type Scan = { revision: number; entries: { el: Element; risky: boolean }[] };
  type State = { documentToken: string; revision: number; onChange?: () => void; scans?: Scan[] };
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
  const targets: (NumberedTarget & { risky?: boolean })[] = [], masks: Rect[] = [], images: { id: number; rect: Rect }[] = [];
  const entries: { el: Element; risky: boolean }[] = [];
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
    if (scanned > 10_000 && !targetsOnly) { blocked = true; return; }
    for (const el of elements) {
      if (el === overlay()) continue;
      const role = el.matches('a[href], [role=link]') ? 'link' : el.matches('button, [role=button]') ? 'button' : undefined;
      if (targetsOnly) {
        if (el.shadowRoot) walk(el.shadowRoot);
        if (!role) continue;
      }
      const rect = rectOf(el);
      if (!rect) continue;
      if (!targetsOnly) {
        if (el.shadowRoot) walk(el.shadowRoot);
        else if (el.localName.includes('-')) blocked = true; // inaccessible custom-control internals
        if (el.matches('iframe, frame, object, embed, video') || el.getAnimations().some(a => a.playState === 'running')) blocked = true;
        if (el.matches('input:not([type=hidden]), textarea, select, [contenteditable]:not([contenteditable=false]), [role=textbox], [role=combobox]')) {
          const mask = rectOf(el, 8); if (mask) masks.push(mask);
          continue;
        }
        if (el.matches('img') && images.length < 100) images.push({ id: nextImage++, rect });
      }
      if (!role || el.matches(':disabled, [aria-disabled=true]')) continue;
      const centerX = rect.x + rect.width / 2 + viewport.offsetLeft, centerY = rect.y + rect.height / 2 + viewport.offsetTop;
      const top = root.elementFromPoint(centerX, centerY);
      if (!top || !(el === top || el.contains(top))) continue;
      if (targets.length >= 100) { targetsTruncated = true; continue; }
      if (targetsOnly) {
        const entry = { el, risky: risky(el, role) };
        entries.push(entry);
        targets.push({ id: nextTarget++, role, rect, risky: entry.risky });
        continue;
      }
      // Avoid nested editable values and text derived from sensitive descendants.
      const label = (el.getAttribute('aria-label') || (!el.querySelector('input, textarea, [contenteditable], select') ? el.textContent : '') || '').trim().slice(0, 200);
      targets.push({ id: nextTarget++, role, rect, ...(label ? { label } : {}) });
    }
  };
  walk(document);
  if (targetsOnly) state.scans = [...(state.scans ?? []), { revision: state.revision, entries }].slice(-3);
  if (targetsOnly) return { documentToken: state.documentToken, revision: state.revision, viewport, targets, targetsTruncated };
  if (masks.length > 1000) blocked = true;
  return { documentToken: state.documentToken, revision: state.revision, viewport, targets, targetsTruncated, images, masks, blocked };
}
