import type { TabInput, TabMatch } from '@iris/protocol';
import { choice, untrusted, voiceTool, words } from './tool';
import type { VoiceTools } from './voice';

export interface NavigationDeps {
  /** Which open tab a request means, answered by the model through the Iris server. */
  matchTab: (input: TabInput) => Promise<TabMatch>;
  /** Arms `run` for the person's next double blink on tab `tabId`; false when no double blink can confirm it. */
  confirm: (tabId: number, run: () => void) => boolean;
  /** Shows what a tool did in the side panel, as the agent also says it. */
  report: (text: string) => void;
}

type ActiveTab = chrome.tabs.Tab & { id: number };
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]; // Chrome's own zoom levels

/** A Chrome call that fails reads as Chrome refusing, never as raw browser text. */
const browser = <T>(call: Promise<T>): Promise<T> => call.catch(() => { throw new Error('BROWSER_REFUSED'); });

/** The focused window's tabs in order, and the one showing. Any tab works, a new tab page included. */
async function windowTabs(): Promise<{ tabs: chrome.tabs.Tab[]; active: ActiveTab }> {
  const [active] = await browser(chrome.tabs.query({ active: true, lastFocusedWindow: true }));
  if (active?.id === undefined) throw new Error('NO_TAB');
  const tabs = await browser(chrome.tabs.query({ windowId: active.windowId }));
  return { tabs: [...tabs].sort((a, b) => a.index - b.index), active: active as ActiveTab };
}

/** A web page's site name, when Iris may see the tab; null otherwise. Never the path or query, which can carry private details. */
function siteOf(url: string | undefined): string | null {
  try {
    const { protocol, hostname } = new URL(url ?? '');
    return /^https?:$/.test(protocol) && /^[A-Za-z0-9.-]{1,253}$/.test(hostname) ? hostname : null;
  } catch { return null; }
}

/** A web address from the agent: a site such as youtube.com, or a full http or https address. Anything else is refused. */
function webAddress(value: unknown): URL {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new Error('INVALID_INPUT');
  const text = value.trim();
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`); }
  catch { throw new Error('INVALID_INPUT'); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || !url.hostname.includes('.')) throw new Error('INVALID_INPUT');
  return url;
}

function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('INVALID_INPUT');
  return value;
}

/**
 * The browser commands the voice agent can ask for beyond the page itself: tabs, websites, search,
 * reload and zoom. Matching a described tab asks the model through the Iris server, with each tab's
 * title and site name only. Closing a tab, which can lose unsaved work, waits for the person's double
 * blink; the rest happen at once, since none of them can submit, pay, delete or send anything.
 */
export function navigationTools({ matchTab, confirm, report }: NavigationDeps): VoiceTools {
  const tool = voiceTool(report);
  return {
    go_to_tab: tool(async ({ description }) => {
      const request = words(description);
      const { tabs } = await windowTabs();
      const offered = tabs.flatMap((tab) => {
        const host = siteOf(tab.url), title = tab.title?.trim().slice(0, 200);
        return tab.id !== undefined && host && title ? [{ id: tab.index + 1, title, host, tabId: tab.id }] : [];
      }).slice(0, 50);
      if (!offered.length) throw new Error('NO_TABS');
      const match = await matchTab({ protocolVersion: '0.1', requestId: crypto.randomUUID(), request,
        tabs: offered.map(({ id, title, host }) => ({ id, title, host })) });
      const chosen = offered.find((tab) => tab.id === match.tabId);
      if (!chosen) return `No open tab clearly matches. ${untrusted(match.explanation)}`;
      await browser(chrome.tabs.update(chosen.tabId, { active: true }));
      return `Switched to the tab on ${chosen.host}.`;
    }),
    switch_tab: tool(async ({ direction }) => {
      const step = choice(direction, ['next', 'previous'] as const) === 'next' ? 1 : -1;
      const { tabs, active } = await windowTabs();
      if (tabs.length < 2) return 'This is the only tab in this window.';
      const at = tabs.findIndex((tab) => tab.id === active.id);
      const to = tabs[(at + step + tabs.length) % tabs.length]!;
      await browser(chrome.tabs.update(to.id!, { active: true }));
      return step > 0 ? 'Switched to the next tab.' : 'Switched to the previous tab.';
    }),
    open_new_tab: tool(async () => {
      const { active } = await windowTabs();
      await browser(chrome.tabs.create({ windowId: active.windowId, active: true }));
      return 'Opened a new tab. Say a website to open, or what to search for.';
    }),
    close_tab: tool(async () => {
      const { active } = await windowTabs();
      const tabId = active.id;
      // Closing can lose unsaved work, so it waits for the person's double blink, and closes the tab
      // only if it is still the one showing then: they may have moved to a tab Iris cannot read.
      const close = async () => {
        const [showing] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
        if (showing?.id === tabId) await chrome.tabs.remove(tabId).catch(() => {});
      };
      if (!confirm(tabId, close)) throw new Error('NEEDS_EYES');
      return 'Blink twice within ten seconds to close this tab.';
    }),
    open_website: tool(async ({ address, new_tab }) => {
      const url = webAddress(address), inNewTab = flag(new_tab);
      const { active } = await windowTabs();
      await browser(inNewTab ? chrome.tabs.create({ windowId: active.windowId, url: url.href, active: true }) : chrome.tabs.update(active.id, { url: url.href }));
      return `Opening ${url.hostname}.`;
    }),
    search_web: tool(async ({ query, new_tab }) => {
      const text = words(query), inNewTab = flag(new_tab);
      const { active } = await windowTabs();
      // The person's own default search engine, as if they had typed into the address bar.
      await browser(chrome.search.query(inNewTab ? { text, disposition: 'NEW_TAB' } : { text, tabId: active.id }));
      return `Searching for ${text}.`;
    }),
    reload_page: tool(async () => {
      const { active } = await windowTabs();
      await browser(chrome.tabs.reload(active.id));
      return 'Reloaded the page.';
    }),
    zoom_page: tool(async ({ direction }) => {
      const to = choice(direction, ['in', 'out', 'reset'] as const);
      const { active } = await windowTabs();
      if (to === 'reset') {
        await browser(chrome.tabs.setZoom(active.id, 0)); // 0 is the person's own default zoom
        return 'Back to normal size.';
      }
      const now = await browser(chrome.tabs.getZoom(active.id));
      const next = to === 'in' ? ZOOM_STEPS.find((z) => z > now + 0.001) : [...ZOOM_STEPS].reverse().find((z) => z < now - 0.001);
      if (next === undefined) return to === 'in' ? 'The page is already as large as it goes.' : 'The page is already as small as it goes.';
      await browser(chrome.tabs.setZoom(active.id, next));
      return `Zoomed to ${Math.round(next * 100)}%.`;
    }),
  };
}
