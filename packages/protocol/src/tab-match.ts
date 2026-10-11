import { id, object, ProtocolError, text, token } from './page-understanding';

/**
 * v0.1 tab matching: which open tab a spoken request means, such as "the tab with the recipe", judged
 * from each tab's title and site name only. Full addresses never leave the browser, and nothing is
 * stored. The answer only names a tab; the extension switches to it.
 */
export const TAB_LIMITS = { tabs: 50, title: 200, request: 500, explanation: 500, bodyBytes: 32 * 1024 } as const;
export interface OpenTab { id: number; title: string; host: string }
export interface TabInput { protocolVersion: '0.1'; requestId: string; request: string; tabs: OpenTab[] }
export interface TabMatch { tabId: number | null; explanation: string }
export interface TabResult { protocolVersion: '0.1'; requestId: string; match: TabMatch }
/** Matches a request to one open tab. The server's model adapter implements it, so no vendor reaches callers. */
export interface TabMatching { matchTab(input: TabInput, signal: AbortSignal): Promise<TabMatch> }

export function validateTabInput(value: unknown): TabInput {
  const base = object(value, ['protocolVersion', 'requestId', 'request', 'tabs']);
  if (base.protocolVersion !== '0.1' || !Array.isArray(base.tabs) || base.tabs.length < 1 || base.tabs.length > TAB_LIMITS.tabs) throw new ProtocolError();
  const ids = new Set<number>();
  const tabs = base.tabs.map((item: unknown): OpenTab => {
    const tab = object(item, ['id', 'title', 'host']);
    const tabId = id(tab.id);
    // A site name only: a path or query could carry private details.
    if (ids.has(tabId) || typeof tab.host !== 'string' || !/^[A-Za-z0-9.-]{1,253}$/.test(tab.host)) throw new ProtocolError();
    ids.add(tabId);
    return { id: tabId, title: text(tab.title, TAB_LIMITS.title), host: tab.host };
  });
  return { protocolVersion: '0.1', requestId: token(base.requestId), request: text(base.request, TAB_LIMITS.request), tabs };
}

export function validateTabMatch(value: unknown, input: TabInput): TabMatch {
  const r = object(value, ['tabId', 'explanation']);
  if (r.tabId !== null && !input.tabs.some((t) => t.id === r.tabId)) throw new ProtocolError();
  return { tabId: r.tabId as number | null, explanation: text(r.explanation, TAB_LIMITS.explanation) };
}

export function validateTabResult(value: unknown, input: TabInput): TabResult {
  const r = object(value, ['protocolVersion', 'requestId', 'match']);
  if (r.protocolVersion !== '0.1' || r.requestId !== input.requestId) throw new ProtocolError();
  return { protocolVersion: '0.1', requestId: input.requestId, match: validateTabMatch(r.match, input) };
}
