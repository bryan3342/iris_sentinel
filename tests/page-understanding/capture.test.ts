import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSameSnapshot, eligibleTab, maskPixels, prepareImage, validateSnapshot } from '../../extension/src/page-understanding/capture';
import type { PageSnapshot } from '../../extension/src/page-understanding/page-helper';

const snapshot = (): PageSnapshot => ({ documentToken: 'abcdefghijklmnop', revision: 1,
  viewport: { width: 200, height: 100, offsetLeft: 0, offsetTop: 0, scale: 1, scrollX: 0, scrollY: 0 },
  targets: [{ id: 2, role: 'button', rect: { x: 20, y: 10, width: 40, height: 20 } }], targetsTruncated: false,
  images: [{ id: 1, rect: { x: 100, y: 0, width: 100, height: 100 } }], masks: [{ x: 10.25, y: 2.25, width: 20.5, height: 5.5 }], blocked: false });
afterEach(() => vi.unstubAllGlobals());
describe('capture safety', () => {
  it.each(['chrome://settings', 'file:///private.txt', 'about:blank', 'chrome-extension://abc/page', 'https://chromewebstore.google.com/detail/a', 'https://chrome.google.com/webstore'])('blocks %s', url => expect(eligibleTab({ url })).toBe(false));
  it('requires eligible, non-incognito, fully committed tabs', () => {
    expect(eligibleTab({ url: 'https://example.com' })).toBe(true);
    expect(eligibleTab({ url: 'https://example.com', incognito: true })).toBe(false);
    expect(eligibleTab({ url: 'https://example.com', pendingUrl: 'https://new.example' })).toBe(false);
  });
  it.each(['revision', 'document', 'scroll', 'geometry', 'sensitive', 'blocked'])('rejects %s capture races', change => {
    const before = snapshot(), after = snapshot();
    if (change === 'revision') after.revision++;
    if (change === 'document') after.documentToken = 'different_document';
    if (change === 'scroll') after.viewport.scrollY++;
    if (change === 'geometry') after.targets[0]!.rect.x++;
    if (change === 'sensitive') after.masks[0]!.width++;
    if (change === 'blocked') after.blocked = true;
    expect(() => assertSameSnapshot(before, after)).toThrow('PAGE_CHANGED');
  });
  it('validates messages, duplicate IDs and unknown fields', () => {
    expect(validateSnapshot(snapshot())).toEqual(snapshot());
    expect(() => validateSnapshot({ ...snapshot(), secret: 'x' })).toThrow();
    const duplicate = snapshot(); duplicate.targets.push(duplicate.targets[0]!);
    expect(() => validateSnapshot(duplicate)).toThrow();
  });
  it('rounds sensitive mask bounds outward in screenshot coordinates', () => {
    const fillRect = vi.fn();
    maskPixels({ fillRect } as unknown as CanvasRenderingContext2D, snapshot().masks, 2, 2);
    expect(fillRect).toHaveBeenCalledWith(20, 4, 42, 12);
  });
  it('places numbered labels relative to the crop and skips targets outside it', async () => {
    const fillText = vi.fn();
    const source = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn(), fillRect: vi.fn() }) };
    const output = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn(), fillRect: vi.fn(), fillText }), toDataURL: () => 'data:image/png;base64,AAAA' };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 200, height: 100, close: vi.fn() })));
    vi.stubGlobal('document', { createElement: vi.fn().mockReturnValueOnce(source).mockReturnValueOnce(output) });
    const s = snapshot();
    s.targets = [{ id: 2, role: 'button', rect: { x: 120, y: 10, width: 40, height: 20 } }, { id: 3, role: 'button', rect: { x: 20, y: 10, width: 40, height: 20 } }];
    await prepareImage('data:image/png;base64,AAAA', s, { x: 100, y: 0, width: 100, height: 100 }, true);
    expect(fillText).toHaveBeenCalledOnce();
    expect(fillText).toHaveBeenCalledWith('2', 22, 11);
  });
  it('masks before creating the supplied image crop and releases bitmaps', async () => {
    const close = vi.fn(), drawImage = vi.fn(), fillRect = vi.fn();
    const source = { width: 0, height: 0, getContext: () => ({ drawImage, fillRect }) };
    const destDraw = vi.fn(); const output = { width: 0, height: 0, getContext: () => ({ drawImage: destDraw }), toDataURL: () => 'data:image/png;base64,AAAA' };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 400, height: 200, close })));
    vi.stubGlobal('document', { createElement: vi.fn().mockReturnValueOnce(source).mockReturnValueOnce(output) });
    const result = await prepareImage('data:image/png;base64,AAAA', snapshot(), snapshot().images[0]!.rect);
    expect(result).toEqual({ mimeType: 'image/png', width: 200, height: 200, data: 'AAAA' });
    expect(destDraw).toHaveBeenCalledWith(source, 200, 0, 200, 200, 0, 0, 200, 200);
    expect(fillRect.mock.invocationCallOrder[0]).toBeLessThan(destDraw.mock.invocationCallOrder[0]!);
    expect(close).toHaveBeenCalledOnce(); expect(source.width).toBe(0); expect(output.width).toBe(0);
  });
});
