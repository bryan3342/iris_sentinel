import { GeminiPageUnderstanding, ServiceError } from "./page-understanding";
import type { Env, FindTargetInput, PageUnderstanding } from "./page-understanding";
import { LIMITS, object, ProtocolError, validateInput, validateUnderstanding, type PageUnderstanding as MultimodalPageUnderstanding } from '../../packages/protocol/src/page-understanding';
import { DemoAccess, type Lease } from './access';
import { abortable, failure, HttpError, json, readJson } from './http';
import { GeminiMultimodal } from './multimodal';
import { validatePng } from './png';
import { FakePageUnderstanding } from './fake-page-understanding';

const MAX_BODY_BYTES = 64 * 1024;
const invalidInput = () => new ServiceError(400, "Invalid target selection input.");

async function readInput(request: Request): Promise<FindTargetInput> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ServiceError(415, "Use application/json.");
  }
  let input: FindTargetInput;
  try {
    input = await readJson(request, MAX_BODY_BYTES, AbortSignal.any([request.signal, AbortSignal.timeout(5000)])) as FindTargetInput;
    object(input, ['request', 'targets']);
  } catch (error) {
    if (error instanceof HttpError) throw new ServiceError(error.status, error.code);
    throw invalidInput();
  }
  if (!input || typeof input.request !== "string" || !input.request.trim() || input.request.length > 500 ||
      !Array.isArray(input.targets) || input.targets.length < 1 || input.targets.length > 100) throw invalidInput();
  const ids = new Set<number>();
  for (const target of input.targets) {
    try { object(target, ['id', 'label', 'role']); } catch { throw invalidInput(); }
    if (!target || !Number.isSafeInteger(target.id) || target.id < 1 || ids.has(target.id) ||
        typeof target.label !== "string" || !target.label.trim() || target.label.length > 200 ||
        !["link", "button"].includes(target.role)) throw invalidInput();
    ids.add(target.id);
  }
  return { request: input.request, targets: input.targets.map(({ id, label, role }) => ({ id, label, role })) };
}

export function createWorker(provider?: PageUnderstanding, multimodal?: MultimodalPageUnderstanding, gate = new DemoAccess()) {
  return { async fetch(request: Request, env: Env = {}): Promise<Response> {
    if (new URL(request.url).pathname === "/health" && request.method === "GET") {
      return json({ status: "ok", service: "iris-server" });
    }
    const path = new URL(request.url).pathname;
    if (path.startsWith('/v0.1/')) {
      const origin = request.headers.get('Origin');
      const cors: Record<string, string> = origin && origin === env.EXTENSION_ORIGIN ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
      const respond = (response: Response) => {
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
      };
      let lease: Lease | undefined;
      let retainLease = false;
      const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(LIMITS.requestMs)]);
      try {
        if (!env.EXTENSION_ORIGIN || !/^chrome-extension:\/\/[a-p]{32}$/.test(env.EXTENSION_ORIGIN)) throw new HttpError(503, 'NOT_CONFIGURED');
        if (origin && origin !== env.EXTENSION_ORIGIN) throw new HttpError(403, 'FORBIDDEN');
        if (request.method === 'OPTIONS') {
          return respond(json(null, 200, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }));
        }
        if (request.method !== 'POST') throw new HttpError(405, 'USE_POST');
        if (env.ENABLE_PAGE_UNDERSTANDING !== 'true') throw new HttpError(503, 'DISABLED');
        const ingestion = AbortSignal.any([deadline, AbortSignal.timeout(LIMITS.ingestionMs)]);
        const operation = path.slice('/v0.1/page-understanding/'.length);
        if (!path.startsWith('/v0.1/page-understanding/') || !['find_target', 'summarize_page', 'describe_image'].includes(operation)) throw new HttpError(404, 'NOT_FOUND');
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
        const synthetic = env.PAGE_UNDERSTANDING_PROVIDER === 'synthetic';
        if (synthetic && !local) throw new HttpError(503, 'NOT_CONFIGURED');
        const delay = Number(env.SYNTHETIC_DELAY_MS || 0);
        if (synthetic && (!Number.isInteger(delay) || delay < 0 || delay > 3000)) throw new HttpError(503, 'NOT_CONFIGURED');
        if (!synthetic && env.PAGE_CONTENT_APPROVED !== 'true') throw new HttpError(503, 'CONTENT_NOT_APPROVED');
        const authorization = request.headers.get('Authorization');
        if (!authorization || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) throw new HttpError(401, 'UNAUTHENTICATED');
        lease = await abortable(gate.admit(env, authorization.slice(7)), deadline);
        const input = validateInput(await readJson(request, LIMITS.bodyBytes, ingestion));
        if (input.operation !== operation) throw new HttpError(400, 'INVALID_INPUT');
        await validatePng(input.image, ingestion);
        let result;
        try {
          const adapter = multimodal ?? (synthetic ? new FakePageUnderstanding(delay) : new GeminiMultimodal(env));
          const method = input.operation === 'find_target' ? 'findTarget' : input.operation === 'summarize_page' ? 'summarizePage' : 'describeImage';
          result = validateUnderstanding(await abortable(adapter[method](input, deadline), deadline), input);
          if (result.operation === 'summarize_page') {
            result = { ...result, summary: `Visible viewport only: ${result.summary}`.slice(0, 2000) };
          }
        }
        catch (error) {
          if (error instanceof ProtocolError) throw new HttpError(502, 'INVALID_MODEL_RESULT');
          throw error;
        }
        return respond(json({ protocolVersion: '0.1', requestId: input.requestId, binding: input.binding, result }));
      } catch (error) {
        retainLease = deadline.aborted || error instanceof HttpError && error.status === 504;
        return respond(failure(deadline.aborted ? new HttpError(504, 'TIMEOUT') : error instanceof ProtocolError ? new HttpError(400, 'INVALID_INPUT') : error));
      } finally {
        if (lease) {
          // Cancellation may leave provider processing. Keep the conservative lease until expiry.
          if (!retainLease && !deadline.aborted) {
            try { gate.release(env, lease); }
            catch { /* Fail closed: lease expires; no logging of session credentials. */ }
          }
        }
      }
    }
    if (new URL(request.url).pathname === "/gemini/find-target") {
      // Compatibility only on localhost, never a deployed unauthenticated alternative.
      if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname) || env.ENABLE_LOCAL_LABELS === 'false') return json({ error: 'Not found' }, 404);
      if (request.method !== "POST") return json({ error: "Use POST." }, 405, { Allow: "POST" });
      try {
        const input = await readInput(request);
        const result = await (provider ?? new GeminiPageUnderstanding(env)).findTarget(input, request.signal);
        if (!result || Object.keys(result).length !== 1 || (result.targetId !== null && !input.targets.some(t => t.id === result.targetId))) throw new ServiceError(502, 'Invalid selection.');
        return json(result);
      } catch (error) {
        const failure = error instanceof ServiceError ? error : invalidInput();
        return json({ error: failure.message }, failure.status);
      }
    }
    return json({ error: "Not found" }, 404);
  } };
}

export default createWorker();
