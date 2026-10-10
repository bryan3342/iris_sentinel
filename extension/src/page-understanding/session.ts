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
/** Runtime-only participant token; never embedded or persisted. */
export class DemoSession {
  private current?: { gateway: string; token: string; expiresAt: number };
  clear(): void { this.current = undefined; }
  set(gateway: string, sessionToken: string): void {
    gateway = gatewayUrl(gateway);
    if (!/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) throw new Error('INVALID_SESSION');
    this.current = { gateway, token: sessionToken, expiresAt: Date.now() + 900_000 };
  }
  require(gateway: string): string {
    if (this.current?.gateway !== gateway || this.current.expiresAt <= Date.now()) {
      this.clear(); throw new Error('DEMO_SESSION_REQUIRED');
    }
    // Actual expiration/revocation is independently enforced by the server.
    return this.current.token;
  }
}
