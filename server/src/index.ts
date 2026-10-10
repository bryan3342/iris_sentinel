import type { Env } from "./page-understanding";
import { LIMITS, object, OPERATIONS, ProtocolError, validateInput, validateUnderstanding, type Operation, type PageUnderstanding } from '../../packages/protocol/src/page-understanding';
import { DemoAccess, type Lease } from './access';
import { abortable, failure, HttpError, json, readJson } from './http';
import { GeminiMultimodal } from './multimodal';
import { validatePng } from './png';
import { FakePageUnderstanding } from './fake-page-understanding';
import { ElevenLabsAgentSession, type AgentSessionProvider } from './routes/agent-token/index';

/** Each operation's route segment and the provider method that answers it. */
const METHODS: Record<Operation, keyof PageUnderstanding> = {
  find_target: 'findTarget', summarize_page: 'summarizePage', describe_image: 'describeImage', describe_target: 'describeTarget',
};

export function createWorker(multimodal?: PageUnderstanding, gate = new DemoAccess(), agent: AgentSessionProvider = new ElevenLabsAgentSession()) {
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
        if (path === '/v0.1/agent-token') {
          if (env.ENABLE_VOICE_AGENT !== 'true') throw new HttpError(503, 'VOICE_DISABLED');
          const authorization = request.headers.get('Authorization');
          if (!authorization || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) throw new HttpError(401, 'UNAUTHENTICATED');
          lease = await abortable(gate.admit(env, authorization.slice(7)), deadline);
          const ingestion = AbortSignal.any([deadline, AbortSignal.timeout(LIMITS.ingestionMs)]);
          object(await readJson(request, 1024, ingestion), []);
          return respond(json(await abortable(agent.createSession(env, deadline), deadline)));
        }
        if (env.ENABLE_PAGE_UNDERSTANDING !== 'true') throw new HttpError(503, 'DISABLED');
        const ingestion = AbortSignal.any([deadline, AbortSignal.timeout(LIMITS.ingestionMs)]);
        const operation = path.slice('/v0.1/page-understanding/'.length);
        if (!path.startsWith('/v0.1/page-understanding/') || !(OPERATIONS as readonly string[]).includes(operation)) throw new HttpError(404, 'NOT_FOUND');
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
          result = validateUnderstanding(await abortable(adapter[METHODS[input.operation]](input, deadline), deadline), input);
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
    return json({ error: "Not found" }, 404);
  } };
}

export default createWorker();
