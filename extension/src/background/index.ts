import { LIMITS, object, token, validateInput, validateResult } from '@iris/protocol';
import { eligibleTab } from '../page-understanding/capture';
import { GATEWAY, responseJson } from '../page-understanding/gateway';

// Clicking the toolbar icon opens the side panel.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: unknown) => console.error('Iris: could not set side panel behavior', error));

let pending: { requestId: string; controller: AbortController } | undefined;
// Only the extension side panel can use this privileged broker. Content scripts cannot.
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('sidepanel.html') || sender.tab) return false;
  const handle = async (): Promise<unknown> => {
    const base = object(message, ['type'], ['tabId', 'windowId', 'input', 'requestId']);
    if (base.type === 'iris.voice.session') {
      object(message, ['type']);
      const response = await fetch(`${GATEWAY}/v0.1/agent-token`, {
        method: 'POST', signal: AbortSignal.timeout(15_000), credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const value = object(await responseJson(response), ['signedUrl']);
      if (typeof value.signedUrl !== 'string' || value.signedUrl.length > 4096) throw new Error('INVALID_RESPONSE');
      const url = new URL(value.signedUrl);
      if (url.protocol !== 'wss:' || url.host !== 'api.elevenlabs.io' || url.username || url.password || url.hash ||
          url.pathname !== '/v1/convai/conversation' || !url.searchParams.get('conversation_signature')) throw new Error('INVALID_RESPONSE');
      return { signedUrl: value.signedUrl };
    }
    if (base.type === 'iris.page.cancel') {
      object(message, ['type', 'requestId']);
      if (pending?.requestId === token(base.requestId)) pending.controller.abort();
      return null;
    }
    if (base.type === 'iris.page.capture') {
      object(message, ['type', 'tabId', 'windowId']);
      if (!Number.isSafeInteger(base.tabId) || !Number.isSafeInteger(base.windowId)) throw new Error('INVALID_INPUT');
      const tab = await chrome.tabs.get(base.tabId as number);
      if (!eligibleTab(tab) || !tab.active || tab.windowId !== base.windowId || !(await chrome.windows.get(tab.windowId)).focused) throw new Error('PAGE_NOT_ALLOWED');
      const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const current = await chrome.tabs.get(tab.id!);
      if (!eligibleTab(current) || !current.active || current.url !== tab.url || !(await chrome.windows.get(tab.windowId)).focused) throw new Error('PAGE_CHANGED');
      return screenshot;
    }
    if (base.type !== 'iris.page.understand') throw new Error('INVALID_INPUT');
    object(message, ['type', 'input']);
    if (pending) throw new Error('REQUEST_IN_FLIGHT');
    const input = validateInput(base.input);
    const controller = new AbortController(); pending = { requestId: input.requestId, controller };
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(LIMITS.requestMs)]);
    try {
      const response = await fetch(`${GATEWAY}/v0.1/page-understanding/${input.operation}`, {
        method: 'POST', signal, credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      });
      return validateResult(await responseJson(response), input);
    } catch (error) {
      if (signal.aborted) throw new Error('CANCELLED_OR_TIMEOUT');
      throw error;
    } finally { pending = undefined; }
  };
  void handle().then(value => respond({ ok: true, value }), error => {
    const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'REQUEST_FAILED';
    respond({ ok: false, code });
  });
  return true;
});
