import { abortable, HttpError, readBytes } from '../../http';

export interface AgentEnv {
  ENABLE_VOICE_AGENT?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_AGENT_ID?: string;
}
export interface AgentSession { signedUrl: string }
export interface AgentSessionProvider {
  createSession(env: AgentEnv, signal: AbortSignal): Promise<AgentSession>;
}

/** Server-only vendor adapter. Credentials and upstream errors are never logged. */
export class ElevenLabsAgentSession implements AgentSessionProvider {
  constructor(private send: typeof fetch = fetch) {}
  async createSession(env: AgentEnv, cancellation: AbortSignal): Promise<AgentSession> {
    const key = env.ELEVENLABS_API_KEY?.trim(), agent = env.ELEVENLABS_AGENT_ID?.trim();
    // Keys start with sk_ and are shown only at creation or rotation; an API key ID cannot authenticate.
    if (!key || key.endsWith('replace_with_your_key') || !/^sk_[A-Za-z0-9]{20,}$/.test(key) ||
        !agent || !/^agent_[A-Za-z0-9_-]{1,100}$/.test(agent)) {
      throw new HttpError(503, 'VOICE_NOT_CONFIGURED');
    }
    const signal = AbortSignal.any([cancellation, AbortSignal.timeout(10_000)]);
    const url = new URL('https://api.elevenlabs.io/v1/convai/conversation/get-signed-url');
    url.searchParams.set('agent_id', agent);
    // ElevenLabs binds the signature to one conversation when this is enabled.
    url.searchParams.set('include_conversation_id', 'true');
    try {
      const send = this.send;
      const response = await abortable(send(url.toString(), {
        headers: { 'xi-api-key': key }, signal, redirect: 'error',
      }), signal);
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new HttpError(response.status === 429 || response.status >= 500 ? 503 : 502, 'VOICE_UNAVAILABLE');
      }
      const bytes = await readBytes(response.body, 8192, signal);
      const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!data || typeof data.signed_url !== 'string' || data.signed_url.length > 4096) throw new Error();
      const signed = new URL(data.signed_url);
      if (signed.protocol !== 'wss:' || signed.host !== 'api.elevenlabs.io' ||
          signed.pathname !== '/v1/convai/conversation' || signed.username || signed.password || signed.hash ||
          signed.searchParams.get('agent_id') !== agent || !signed.searchParams.get('conversation_signature')) throw new Error();
      return { signedUrl: data.signed_url };
    } catch (error) {
      if (signal.aborted || error instanceof HttpError && error.status === 504) throw new HttpError(504, 'TIMEOUT');
      if (error instanceof HttpError && error.code === 'VOICE_UNAVAILABLE') throw error;
      throw new HttpError(502, 'VOICE_UNAVAILABLE');
    }
  }
}
