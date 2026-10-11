import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type Listener = (message: unknown, sender: { id?: string; url?: string; tab?: unknown }, respond: (reply: unknown) => void) => boolean;
let listener: Listener;
const input = { protocolVersion: '0.1', requestId: 'request_abcdefghijklmnop', request: 'the tab with the recipe',
  tabs: [{ id: 1, title: 'Inbox', host: 'mail.example.com' }, { id: 2, title: 'Chocolate chip cookies', host: 'recipes.example.com' }] };
const fromPanel = { id: 'iris', url: 'chrome-extension://iris/sidepanel.html' };
const ask = (message: unknown, sender = fromPanel) => new Promise((resolve) => listener(message, sender, resolve));

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('chrome', {
    sidePanel: { setPanelBehavior: vi.fn(async () => {}) },
    runtime: { id: 'iris', getURL: (path: string) => `chrome-extension://iris/${path}`, onMessage: { addListener: (l: Listener) => { listener = l; } } },
  });
  await import('../../extension/src/background/index');
});
afterEach(() => vi.unstubAllGlobals());

it('asks the Iris server on this computer which tab a request means, and returns only a checked match', async () => {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json({ protocolVersion: '0.1', requestId: input.requestId, match: { tabId: 2, explanation: 'The cookie recipe.' } }));
  vi.stubGlobal('fetch', fetch);
  expect(await ask({ type: 'iris.tabs.match', input })).toEqual({ ok: true, value: { tabId: 2, explanation: 'The cookie recipe.' } });
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe('http://127.0.0.1:8787/v0.1/tab-match');
  expect([init.method, init.credentials, JSON.parse(init.body as string)]).toEqual(['POST', 'omit', input]);
});

it('passes on the server\'s reason when it refuses', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'CONTENT_NOT_APPROVED' } }, { status: 503 })));
  expect(await ask({ type: 'iris.tabs.match', input })).toEqual({ ok: false, code: 'CONTENT_NOT_APPROVED' });
});

it('sends nothing for a tab request that carries more than titles and sites, or that does not come from the side panel', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const withAddress = { ...input, tabs: [{ ...input.tabs[0]!, url: 'https://mail.example.com/?token=1' }] };
  expect(await ask({ type: 'iris.tabs.match', input: withAddress })).toMatchObject({ ok: false });
  expect(listener({ type: 'iris.tabs.match', input }, { id: 'iris', url: 'https://evil.example/', tab: {} }, () => {})).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
