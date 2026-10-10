import { object, text } from '@iris/protocol';

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader(); if (!reader) throw new Error('INVALID_RESPONSE');
  try {
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length; if (length > 8192) { void reader.cancel(); throw new Error('INVALID_RESPONSE'); } chunks.push(value);
    }
    const bytes = new Uint8Array(length); let position = 0;
    for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!response.ok) {
      const body = object(value, ['error']), error = object(body.error, ['code']);
      const code = text(error.code, 80);
      throw new Error(/^[A-Z_]+$/.test(code) ? code : 'REQUEST_FAILED');
    }
    return value as Record<string, unknown>;
  } finally { reader.releaseLock(); }
}
export { responseJson };
/** Gateway is operator-configured; no page or voice tool can choose it. */
export function gatewayUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('INVALID_GATEWAY');
  return url.origin;
}
type SessionArea = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;
interface StoredSession { gateway: string; token: string; expiresAt: number }
const KEY = 'iris:demo-session';
/**
 * Participant token, never embedded. Chrome's session storage holds it in memory only:
 * never written to disk, hidden from content scripts, and kept when Chrome stops the
 * idle background worker after about 30 seconds, which would lose a plain variable.
 */
export class DemoSession {
  constructor(private readonly area: SessionArea = chrome.storage.session) {}
  clear(): Promise<void> { return this.area.remove(KEY); }
  async set(gateway: string, sessionToken: string): Promise<void> {
    gateway = gatewayUrl(gateway);
    if (!/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) throw new Error('INVALID_SESSION');
    const session: StoredSession = { gateway, token: sessionToken, expiresAt: Date.now() + 900_000 };
    await this.area.set({ [KEY]: session });
  }
  async require(gateway: string): Promise<string> {
    const current = (await this.area.get(KEY))[KEY] as StoredSession | undefined;
    if (current?.gateway !== gateway || current.expiresAt <= Date.now()) {
      await this.clear(); throw new Error('DEMO_SESSION_REQUIRED');
    }
    // Actual expiration/revocation is independently enforced by the server.
    return current.token;
  }
}
