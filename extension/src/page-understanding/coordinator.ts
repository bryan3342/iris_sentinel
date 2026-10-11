import { LIMITS, validateInput, validateRect, validateResult, type NumberedTarget, type Operation, type PageResult, type Point2, type Rect, type Viewport } from '@iris/protocol';
import { pageOverlay, type OverlayCommand, type OverlayResult } from '../content/overlay';
import { assertSameSnapshot, eligibleTab, prepareImage, targetCrop, validateSnapshot } from './capture';
import { pageRegionAt, pageSnapshot, type PageSnapshot } from './page-helper';

/** The target gaze rested on, as numbered in the gaze scan. */
export interface AimedTarget { documentToken: string; id: number; rect: Rect }
/** `lookedAt`, for a summary, is where the eyes rested (viewport pixels): only the block there is summarized, never the whole viewport. */
export interface DemoRequest { operation: Operation; request?: string; imageId?: number; aimed?: AimedTarget | null; lookedAt?: Point2 | null }
export interface BrokerReply { ok: boolean; value?: unknown; code?: string }
export async function broker(message: unknown): Promise<unknown> {
  const reply: BrokerReply = await chrome.runtime.sendMessage(message);
  if (!reply || typeof reply !== 'object' || Object.keys(reply).some(k => !['ok', 'value', 'code'].includes(k)) || typeof reply.ok !== 'boolean') throw new Error('INVALID_RESPONSE');
  if (!reply.ok) throw new Error(reply.code && /^[A-Z_]+$/.test(reply.code) ? reply.code : 'REQUEST_FAILED');
  return reply.value;
}
export async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !eligibleTab(tab) || !(await chrome.windows.get(tab.windowId)).focused) throw new Error('PAGE_NOT_ALLOWED');
  return tab;
}
async function snapshot(tabId: number): Promise<PageSnapshot> {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func: pageSnapshot });
  if (results.length !== 1 || results[0]?.frameId !== 0) throw new Error('UNSUPPORTED_PAGE');
  const result = validateSnapshot(results[0].result);
  if (result.blocked) throw new Error('UNSUPPORTED_PAGE');
  return result;
}
/** The aimed target in this snapshot: same document, same number, still where gaze saw it. Numbering matches the gaze scan. */
function aimedTarget(aimed: AimedTarget | null | undefined, snapshot: PageSnapshot): NumberedTarget {
  if (!aimed) throw new Error('NO_AIMED_TARGET');
  const target = snapshot.targets.find(t => t.id === aimed.id);
  if (aimed.documentToken !== snapshot.documentToken || !target ||
    Math.abs(target.rect.x - aimed.rect.x) > 4 || Math.abs(target.rect.y - aimed.rect.y) > 4) throw new Error('PAGE_CHANGED');
  return target;
}
/** The content block at `at`, or null when there is none to summarize on its own. */
async function regionAt(tabId: number, at: Point2, viewport: Viewport): Promise<Rect | null> {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: pageRegionAt, args: [at] });
  try { return result?.result ? validateRect(result.result, viewport) : null; } catch { return null; }
}
async function overlay(tabId: number, command: OverlayCommand): Promise<OverlayResult | undefined> {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func: pageOverlay, args: [command] });
  return results[0]?.result as OverlayResult | undefined;
}
export interface CoordinatorOptions {
  /** Called once the screenshot is taken, so whatever Iris drew before it can be drawn again. */
  afterCapture?: () => void;
}
/** Iris coordinator. UI owns temporary canvases; background owns sessions and HTTP. */
export class PageCoordinator {
  private pending?: { requestId: string; controller: AbortController };
  private imageList?: { tabId: number; snapshot: PageSnapshot };
  constructor(private readonly options: CoordinatorOptions = {}) {}
  cancel(): void {
    if (!this.pending) return;
    this.pending.controller.abort();
    void broker({ type: 'iris.page.cancel', requestId: this.pending.requestId }).catch(() => {});
  }
  /** `found` is where a found target was in the examined page, so acting on it later can check it has not moved. */
  async inspect(request: DemoRequest): Promise<{ result: PageResult; targetsTruncated: boolean; highlighted: boolean; found: Rect | null }> {
    if (this.pending) throw new Error('REQUEST_IN_FLIGHT');
    const requestId = crypto.randomUUID(), controller = new AbortController();
    this.pending = { requestId, controller };
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(LIMITS.requestMs)]);
    let interval: ReturnType<typeof setInterval> | undefined;
    let tab: chrome.tabs.Tab | undefined;
    const invalidate = () => this.cancel();
    // Only a change to the examined tab or its window cancels; other tabs and windows may change freely.
    const activated = (info: chrome.tabs.OnActivatedInfo) => { if (tab && info.windowId === tab.windowId && info.tabId !== tab.id) invalidate(); };
    const updated = (updatedId: number) => { if (tab && updatedId === tab.id) invalidate(); };
    const focused = (windowId: number) => { if (tab && windowId !== tab.windowId) invalidate(); };
    const abort = () => { void broker({ type: 'iris.page.cancel', requestId }).catch(() => {}); };
    chrome.tabs.onActivated.addListener(activated);
    chrome.tabs.onUpdated.addListener(updated);
    chrome.windows.onFocusChanged.addListener(focused);
    signal.addEventListener('abort', abort, { once: true });
    try {
      tab = await activeTab();
      const tabId = tab.id!, url = tab.url;
      const before = await snapshot(tabId);
      if (request.operation === 'describe_image') {
        if (this.imageList?.tabId !== tabId) throw new Error('LIST_IMAGES_FIRST');
        assertSameSnapshot(this.imageList.snapshot, before);
      }
      if (request.operation === 'find_target' && !before.targets.length) throw new Error('NO_TARGETS');
      const selected = request.operation === 'describe_image' ? before.images.find(i => i.id === request.imageId) : undefined;
      if (request.operation === 'describe_image' && !selected) throw new Error('IMAGE_NOT_FOUND');
      const aimed = request.operation === 'describe_target' ? aimedTarget(request.aimed, before) : undefined;
      const region = request.operation === 'summarize_page' && request.lookedAt ? await regionAt(tabId, request.lookedAt, before.viewport) : null;
      if (request.lookedAt && !region) throw new Error('NOTHING_LOOKED_AT');
      const outlined = aimed?.rect ?? region ?? undefined; // outlined in the image, so Gemini knows which part is meant
      const crop = selected?.rect ?? (outlined && targetCrop(outlined, before.viewport));
      // Gemini sees the page itself, never Iris's own numbers or highlight. The hold stops gaze
      // from drawing them again until the screenshot is taken.
      await overlay(tabId, { type: 'hold' });
      let captured: unknown;
      try {
        captured = await broker({ type: 'iris.page.capture', tabId, windowId: tab.windowId });
      } finally {
        await overlay(tabId, { type: 'release' }).catch(() => undefined);
        this.options.afterCapture?.();
      }
      signal.throwIfAborted();
      if (typeof captured !== 'string') throw new Error('INVALID_CAPTURE');
      const check = async () => {
        const current = await activeTab();
        if (current.id !== tabId || current.url !== url) throw new Error('PAGE_CHANGED');
        assertSameSnapshot(before, await snapshot(tabId)); signal.throwIfAborted();
      };
      await check();
      const image = await prepareImage(captured, before, crop,
        request.operation === 'find_target' ? 'numbers' : outlined && { outline: outlined });
      await check();
      const input = validateInput({ protocolVersion: '0.1', requestId, operation: request.operation,
        binding: { tabToken: crypto.randomUUID(), documentToken: before.documentToken, revision: before.revision,
          captureId: crypto.randomUUID(), viewport: before.viewport }, image,
        ...(request.operation === 'find_target' ? { request: request.request, targets: before.targets, targetsTruncated: before.targetsTruncated } : {}),
        ...(selected ? { imageId: selected.id, sourceRect: selected.rect } : {}),
        ...(aimed && crop ? { targets: [aimed], targetId: aimed.id, sourceRect: crop } : {}),
        ...(region && crop ? { sourceRect: crop } : {}),
      });
      // No overlapping snapshot checks. Changes cancel HTTP, not just result display.
      let checking = false;
      interval = setInterval(() => {
        if (checking || signal.aborted) return;
        checking = true;
        void check().catch(invalidate).finally(() => { checking = false; });
      }, 250);
      const result = validateResult(await broker({ type: 'iris.page.understand', input }), input);
      await check();
      // Drawing only; the overlay refuses if the page changed since the snapshot. Nothing clicks.
      const targetId = result.result.operation === 'find_target' ? result.result.targetId : null;
      const highlighted = targetId !== null && await overlay(tabId, { type: 'show', documentToken: before.documentToken,
        revision: before.revision, targets: before.targets, highlight: targetId }).then(r => r === 'SHOWN', () => false);
      const found = targetId === null ? null : before.targets.find(t => t.id === targetId)?.rect ?? null;
      return { result, targetsTruncated: before.targetsTruncated, highlighted, found };
    } catch (error) {
      if (signal.aborted) throw new Error('PAGE_CHANGED_OR_CANCELLED');
      throw error;
    } finally {
      if (interval) clearInterval(interval);
      chrome.tabs.onActivated.removeListener(activated);
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.windows.onFocusChanged.removeListener(focused);
      signal.removeEventListener('abort', abort);
      this.pending = undefined;
    }
  }
  async images(): Promise<{ id: number }[]> {
    const tab = await activeTab();
    const current = await snapshot(tab.id!);
    this.imageList = { tabId: tab.id!, snapshot: current };
    return current.images.map(({ id }) => ({ id }));
  }
}
