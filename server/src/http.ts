export class HttpError extends Error {
  constructor(public status: number, public code: string, public retryAfter?: number) { super(code); }
}
export function json(value: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
}
export function failure(error: unknown): Response {
  const e = error instanceof HttpError ? error : new HttpError(503, 'UNAVAILABLE');
  return json({ error: { code: e.code } }, e.status, e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : {});
}
/** Race readers against cancellation even when an underlying stream ignores abort. */
export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let listener: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    listener = () => reject(new HttpError(504, 'TIMEOUT'));
    signal.addEventListener('abort', listener, { once: true });
  });
  try { return await Promise.race([promise, aborted]); }
  finally { signal.removeEventListener('abort', listener); }
}
export async function readBytes(body: ReadableStream<Uint8Array> | null, max: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!body) throw new HttpError(400, 'INVALID_INPUT');
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new HttpError(413, 'BODY_TOO_LARGE');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } catch (error) {
    void reader.cancel().catch(() => {}); throw error;
  } finally { reader.releaseLock(); }
}
export async function readJson(request: Request, max: number, signal: AbortSignal): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'USE_JSON');
  if (request.headers.has('content-encoding')) throw new HttpError(415, 'UNSUPPORTED_ENCODING');
  const bytes = await readBytes(request.body, max, signal);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new HttpError(400, 'INVALID_INPUT'); }
}
