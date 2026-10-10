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
/**
 * The Iris server on this computer (`npm run dev` in server/). It holds the Gemini key; the
 * extension holds none. It answers only this extension, so no token or address is entered.
 */
export const GATEWAY = 'http://127.0.0.1:8787';
