import { GeminiPageUnderstanding, ServiceError } from './page-understanding';
import type { Env, PageUnderstanding, FindTargetInput } from './page-understanding';
import { object } from '../../packages/protocol/src/page-understanding';
import { HttpError, json, readJson } from './http';
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

export function createWorker(provider?: PageUnderstanding) {
  return { async fetch(request: Request, env: Env = {}): Promise<Response> {
    if (new URL(request.url).pathname === '/health' && request.method === 'GET') {
      return json({ status: 'ok', service: 'iris-server' });
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
