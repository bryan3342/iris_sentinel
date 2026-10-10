import { GeminiPageUnderstanding, ServiceError } from "./page-understanding";
import type { Env, FindTargetInput, PageUnderstanding } from "./page-understanding";

const MAX_BODY_BYTES = 64 * 1024;
const invalidInput = () => new ServiceError(400, "Invalid target selection input.");

async function readInput(request: Request): Promise<FindTargetInput> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ServiceError(415, "Use application/json.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw invalidInput();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ServiceError(413, "Request body is too large.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let input: FindTargetInput;
  try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw invalidInput(); }
  if (!input || typeof input.request !== "string" || !input.request.trim() || input.request.length > 500 ||
      !Array.isArray(input.targets) || input.targets.length < 1 || input.targets.length > 100) throw invalidInput();
  const ids = new Set<number>();
  for (const target of input.targets) {
    if (!target || !Number.isSafeInteger(target.id) || target.id < 1 || ids.has(target.id) ||
        typeof target.label !== "string" || !target.label.trim() || target.label.length > 200 ||
        !["link", "button"].includes(target.role)) throw invalidInput();
    ids.add(target.id);
  }
  return { request: input.request, targets: input.targets.map(({ id, label, role }) => ({ id, label, role })) };
}

export function createWorker(provider?: PageUnderstanding) {
  return { async fetch(request: Request, env: Env = {}): Promise<Response> {
    if (new URL(request.url).pathname === "/health" && request.method === "GET") {
      return Response.json({ status: "ok", service: "iris-server" });
    }
    if (new URL(request.url).pathname === "/gemini/find-target") {
      if (request.method !== "POST") return Response.json({ error: "Use POST." }, { status: 405, headers: { Allow: "POST" } });
      try {
        const input = await readInput(request);
        return Response.json(await (provider ?? new GeminiPageUnderstanding(env)).findTarget(input));
      } catch (error) {
        const failure = error instanceof ServiceError ? error : invalidInput();
        return Response.json({ error: failure.message }, { status: failure.status });
      }
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  } };
}

export default createWorker();
