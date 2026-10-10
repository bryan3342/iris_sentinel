import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PageSnapshot } from '../../extension/src/page-understanding/page-helper';
import { PageCoordinator } from '../../extension/src/page-understanding/coordinator';

vi.mock('../../extension/src/page-understanding/capture', async () => ({
  ...await vi.importActual('../../extension/src/page-understanding/capture'),
  prepareImage: vi.fn(async () => ({ mimeType: 'image/png', width: 2, height: 2, data: 'AAAA' })),
}));
const page = (): PageSnapshot => ({ documentToken: 'document_abcdefghijklmnop', revision: 0,
  viewport: { width: 2, height: 2, offsetLeft: 0, offsetTop: 0, scale: 1, scrollX: 0, scrollY: 0 },
  targets: [{ id: 1, role: 'button', rect: { x: 0, y: 0, width: 1, height: 1 } }],
  targetsTruncated: false, images: [{ id: 1, rect: { x: 0, y: 0, width: 2, height: 2 } }], masks: [], blocked: false });
type Send = (message: any) => Promise<any>;
let current: PageSnapshot, tabId: number, send: ReturnType<typeof vi.fn<Send>>;
const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
beforeEach(() => {
  current = page(); tabId = 1;
  send = vi.fn(async message => {
    if (message.type === 'iris.page.capture') return { ok: true, value: 'data:image/png;base64,AAAA' };
    if (message.type === 'iris.page.cancel') return { ok: true, value: null };
    return { ok: true, value: { protocolVersion: '0.1', requestId: message.input.requestId, binding: message.input.binding,
      result: message.input.operation === 'describe_image' ? { operation: 'describe_image', imageId: 1, description: 'Synthetic crop.' }
        : { operation: 'find_target', targetId: 1, explanation: 'Synthetic match.' } } };
  });
  vi.stubGlobal('chrome', {
    tabs: { query: vi.fn(async () => [{ id: tabId, windowId: 1, url: 'https://example.com' }]), onActivated: event(), onUpdated: event() },
    windows: { get: vi.fn(async () => ({ focused: true })), onFocusChanged: event() },
    scripting: { executeScript: vi.fn(async () => [{ frameId: 0, result: structuredClone(current) }]) },
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
