import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PageSnapshot } from '../../extension/src/page-understanding/page-helper';
import { PageCoordinator } from '../../extension/src/page-understanding/coordinator';
import { prepareImage } from '../../extension/src/page-understanding/capture';

vi.mock('../../extension/src/page-understanding/capture', async () => ({
  ...await vi.importActual('../../extension/src/page-understanding/capture'),
  prepareImage: vi.fn(async () => ({ mimeType: 'image/png', width: 2, height: 2, data: 'AAAA' })),
}));
const page = (): PageSnapshot => ({ documentToken: 'document_abcdefghijklmnop', revision: 0,
  viewport: { width: 2, height: 2, offsetLeft: 0, offsetTop: 0, scale: 1, scrollX: 0, scrollY: 0 },
  targets: [{ id: 1, role: 'button', rect: { x: 0, y: 0, width: 1, height: 1 } }],
  targetsTruncated: false, images: [{ id: 1, rect: { x: 0, y: 0, width: 2, height: 2 } }], masks: [], blocked: false });
type Send = (message: any) => Promise<any>;
let current: PageSnapshot, tabId: number, send: ReturnType<typeof vi.fn<Send>>, events: string[], overlayReply: string;
const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
beforeEach(() => {
  current = page(); tabId = 1; events = []; overlayReply = 'SHOWN';
  send = vi.fn(async message => {
    events.push(message.type);
    if (message.type === 'iris.page.capture') return { ok: true, value: 'data:image/png;base64,AAAA' };
    if (message.type === 'iris.page.cancel') return { ok: true, value: null };
    return { ok: true, value: { protocolVersion: '0.1', requestId: message.input.requestId, binding: message.input.binding,
      result: message.input.operation === 'describe_image' ? { operation: 'describe_image', imageId: 1, description: 'Sample crop.' }
        : message.input.operation === 'describe_target' ? { operation: 'describe_target', targetId: message.input.targetId, description: 'Sample target.' }
        : { operation: 'find_target', targetId: 1, explanation: 'Sample match.' } } };
  });
  vi.stubGlobal('chrome', {
    tabs: { query: vi.fn(async () => [{ id: tabId, windowId: 1, url: 'https://example.com' }]), onActivated: event(), onUpdated: event() },
    windows: { get: vi.fn(async () => ({ focused: true })), onFocusChanged: event() },
    scripting: { executeScript: vi.fn(async ({ func, args }) => {
      if (func.name !== 'pageOverlay') return [{ frameId: 0, result: structuredClone(current) }];
      events.push(`overlay.${args[0].type}`);
      if (args[0].type === 'show') events.push(JSON.stringify([args[0].documentToken, args[0].revision, args[0].highlight]));
      return [{ frameId: 0, result: args[0].type === 'show' ? overlayReply : 'CLEARED' }];
    }) },
    runtime: { sendMessage: send },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const find = { gateway: 'https://demo.example', operation: 'find_target' as const, request: 'Find the icon' };
it('explicit requests return a validated recommendation, without an action executor', async () => {
  const coordinator = new PageCoordinator(); const response = await coordinator.inspect(find);
  expect(response.result.result.operation).toBe('find_target');
  expect(send.mock.calls.map(([message]) => message.type)).toEqual(['iris.page.capture', 'iris.page.understand']);
});
it('rejects a capture race before transmitting screenshot bytes', async () => {
  send.mockImplementation(async message => {
    if (message.type === 'iris.page.capture') { current.revision++; return { ok: true, value: 'data:image/png;base64,AAAA' }; }
    throw new Error('Unexpected transmission');
  });
  await expect(new PageCoordinator().inspect(find)).rejects.toThrow('PAGE_CHANGED');
  expect(send).toHaveBeenCalledTimes(1);
});
it('discards stale target results and never reuses the old ID in a new document', async () => {
  const previous = send.getMockImplementation()!;
  send.mockImplementation(async message => {
    const response = await previous(message);
    if (message.type === 'iris.page.understand') current.documentToken = 'new_document_abcdefghijklmnop';
    return response;
  });
  await expect(new PageCoordinator().inspect(find)).rejects.toThrow('PAGE_CHANGED');
});
it('discards a result after the active tab changes', async () => {
  const previous = send.getMockImplementation()!;
  send.mockImplementation(async message => { const response = await previous(message); if (message.type === 'iris.page.understand') tabId = 2; return response; });
  await expect(new PageCoordinator().inspect(find)).rejects.toThrow('PAGE_CHANGED');
});
it('image numbers are bound to the listed document and revision', async () => {
  const coordinator = new PageCoordinator();
  const describe = { gateway: find.gateway, operation: 'describe_image' as const, imageId: 1 };
  await expect(coordinator.inspect(describe)).rejects.toThrow('LIST_IMAGES_FIRST');
  await coordinator.images(); current.revision++;
  await expect(coordinator.inspect(describe)).rejects.toThrow('PAGE_CHANGED');
  await coordinator.images(); expect((await coordinator.inspect(describe)).result.result.operation).toBe('describe_image');
});
it('an invented model ID is rejected at the client boundary', async () => {
  const previous = send.getMockImplementation()!;
  send.mockImplementation(async message => {
    const response = await previous(message);
    if (message.type === 'iris.page.understand') response.value.result.targetId = 99;
    return response;
  });
  await expect(new PageCoordinator().inspect(find)).rejects.toThrow();
});
it('holds the overlay clear during capture and highlights only the validated target afterwards', async () => {
  const response = await new PageCoordinator().inspect(find);
  expect(response.highlighted).toBe(true);
  expect(events).toEqual(['overlay.hold', 'iris.page.capture', 'overlay.release', 'iris.page.understand', 'overlay.show',
    JSON.stringify([current.documentToken, current.revision, 1])]);
  overlayReply = 'STALE'; events = [];
  expect((await new PageCoordinator().inspect(find)).highlighted).toBe(false);
});
it('lets Iris redraw its own marks once the screenshot is taken', async () => {
  const afterCapture = vi.fn(() => events.push('afterCapture'));
  await new PageCoordinator({ afterCapture }).inspect(find);
  expect(events.slice(0, 4)).toEqual(['overlay.hold', 'iris.page.capture', 'overlay.release', 'afterCapture']);
});
const fire = (name: 'onActivated' | 'onUpdated' | 'onFocusChanged', ...args: unknown[]) => {
  const source = name === 'onFocusChanged' ? (globalThis as any).chrome.windows : (globalThis as any).chrome.tabs;
  source[name].addListener.mock.calls.forEach(([listener]: [(...a: unknown[]) => void]) => listener(...args));
};
it.each([
  ['another tab loads', 'onUpdated', [7, { status: 'loading' }]],
  ['a tab in another window opens', 'onActivated', [{ tabId: 7, windowId: 2 }]],
  ['the same window regains focus', 'onFocusChanged', [1]],
] as const)('keeps the request when %s', async (_name, event, args) => {
  const previous = send.getMockImplementation()!;
  send.mockImplementation(async message => { if (message.type === 'iris.page.understand') fire(event, ...args); return previous(message); });
  expect((await new PageCoordinator().inspect(find)).result.result.operation).toBe('find_target');
});
it.each([
  ['the examined tab updates', 'onUpdated', [1, { status: 'loading' }]],
  ['another tab in its window becomes active', 'onActivated', [{ tabId: 7, windowId: 1 }]],
  ['another window takes focus', 'onFocusChanged', [2]],
] as const)('cancels the request when %s', async (_name, event, args) => {
  const previous = send.getMockImplementation()!;
  send.mockImplementation(async message => { if (message.type === 'iris.page.understand') fire(event, ...args); return previous(message); });
  await expect(new PageCoordinator().inspect(find)).rejects.toThrow('PAGE_CHANGED_OR_CANCELLED');
});
const aimedAt = (rect = page().targets[0]!.rect) => ({ documentToken: page().documentToken, id: 1, rect });
const describe = { gateway: find.gateway, operation: 'describe_target' as const };
it('describes the aimed target from an outlined crop around it, without clicking', async () => {
  const response = await new PageCoordinator().inspect({ ...describe, aimed: aimedAt() });
  expect(response.result.result).toEqual({ operation: 'describe_target', targetId: 1, description: 'Sample target.' });
  const sent = send.mock.calls.map(([m]) => m).find(m => m.type === 'iris.page.understand').input;
  expect([sent.targets, sent.targetId, sent.sourceRect]).toEqual([[page().targets[0]], 1, { x: 0, y: 0, width: 2, height: 2 }]);
  expect(vi.mocked(prepareImage).mock.lastCall!.slice(2)).toEqual([{ x: 0, y: 0, width: 2, height: 2 }, { outline: page().targets[0]!.rect }]);
  expect(events).not.toContain('overlay.show');
});
it('sends nothing without an aimed target, or once the aimed target has moved', async () => {
  await expect(new PageCoordinator().inspect({ ...describe, aimed: null })).rejects.toThrow('NO_AIMED_TARGET');
  await expect(new PageCoordinator().inspect({ ...describe, aimed: aimedAt({ x: 10, y: 0, width: 1, height: 1 }) }))
    .rejects.toThrow('PAGE_CHANGED');
  await expect(new PageCoordinator().inspect({ ...describe, aimed: { ...aimedAt(), documentToken: 'other_document_abcdefgh' } }))
    .rejects.toThrow('PAGE_CHANGED');
  expect(events).not.toContain('iris.page.capture');
});
