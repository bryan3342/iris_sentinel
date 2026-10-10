import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveTargetList, type TargetList } from '../../extension/src/sidepanel/target-list';

const VIEWPORT = { width: 800, height: 600, offsetLeft: 0, offsetTop: 0, scale: 1, scrollX: 0, scrollY: 0 };
interface Page { url: string; documentToken: string; revision: number; scanned: boolean }
let tabs: Map<number, Page>, active: number, calls: string[], windowLeft: number;

function page(url: string, documentToken: string): Page {
  return { url, documentToken, revision: 0, scanned: false };
}

beforeEach(() => {
  vi.useFakeTimers();
  tabs = new Map([[1, page('https://example.com', 'document_one_abcdefghij')], [2, page('chrome://settings', 'document_two_abcdefghij')]]);
  active = 1;
  calls = [];
  windowLeft = 0;
  vi.stubGlobal('chrome', {
    tabs: { query: vi.fn(async () => [{ id: active, windowId: 9, url: tabs.get(active)!.url }]) },
    windows: { get: vi.fn(async () => ({ left: windowLeft, top: 40 })) },
    scripting: {
      executeScript: vi.fn(async ({ target, func }: { target: { tabId: number }; func: { name: string } }) => {
        const p = tabs.get(target.tabId)!;
        calls.push(`${func.name}:${target.tabId}`);
        if (func.name === 'pageRevision') return [{ frameId: 0, result: p.scanned ? { documentToken: p.documentToken, revision: p.revision } : null }];
        p.scanned = true;
        const targets = [{ id: 1, role: 'link', rect: { x: 10, y: 10 + p.revision, width: 100, height: 20 }, risky: false }];
        return [{ frameId: 0, result: { documentToken: p.documentToken, revision: p.revision, viewport: VIEWPORT, targets, targetsTruncated: false } }];
      }),
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function run(list: LiveTargetList, ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('LiveTargetList', () => {
  it('scans once, then only reads the change counter while the page is unchanged', async () => {
    const list = new LiveTargetList();
    const seen: (TargetList | null)[] = [];
    list.onChange((l) => seen.push(l));
    list.start();
    await run(list, 1000);
    expect(calls.filter((c) => c.startsWith('pageSnapshot'))).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith('pageRevision')).length).toBeGreaterThanOrEqual(3);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ tabId: 1, documentToken: 'document_one_abcdefghij', revision: 0 });
    list.stop();
  });

  it('rescans when the page changes or navigates, publishing lists bound to the new revision', async () => {
    const list = new LiveTargetList();
    list.start();
    await run(list, 300);
    tabs.get(1)!.revision = 4; // a scroll
    await run(list, 300);
    expect(list.list).toMatchObject({ revision: 4, targets: [{ rect: { y: 14 } }] });
    tabs.set(1, page('https://other.example', 'document_new_abcdefghij')); // followed a link
    await run(list, 300);
    expect(list.list).toMatchObject({ documentToken: 'document_new_abcdefghij', revision: 0 });
    list.stop();
  });

  it('follows tab switches and reports null for a tab it cannot read', async () => {
    const list = new LiveTargetList();
    list.start();
    await run(list, 300);
    active = 2; // a browser settings page
    await run(list, 300);
    expect(list.list).toBeNull();
    expect(calls.some((c) => c.endsWith(':2'))).toBe(false); // never touched
    active = 1;
    await run(list, 300);
    expect(list.list).toMatchObject({ tabId: 1 });
    list.stop();
  });

  it('stops reading and publishes null after stop()', async () => {
    const list = new LiveTargetList();
    const seen: (TargetList | null)[] = [];
    list.onChange((l) => seen.push(l));
    list.start();
    await run(list, 300);
    list.stop();
    const count = calls.length;
    await run(list, 1000);
    expect(calls).toHaveLength(count);
    expect(seen.at(-1)).toBeNull();
  });

  it('republishes the same targets with the new window position when the window moves, without rescanning', async () => {
    const list = new LiveTargetList();
    list.start();
    await run(list, 300);
    const before = list.list!;
    windowLeft = 250;
    await run(list, 300);
    expect(list.list).not.toBe(before);
    expect(list.list).toMatchObject({ window: { left: 250, top: 40 }, targets: before.targets, revision: before.revision });
    expect(calls.filter((c) => c.startsWith('pageSnapshot'))).toHaveLength(1);
    list.stop();
  });
});
