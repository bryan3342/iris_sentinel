import type { VoiceAgent, VoiceSession, VoiceState, VoiceTools } from './voice';

/** Keeps a late connection from reopening the microphone after Stop or panel closure. */
export class VoiceController {
  private generation = 0;
  private session?: VoiceSession;
  private starting = false;
  private stopping = false;
  constructor(private agent: VoiceAgent, private onState: (state: VoiceState) => void, private tools: VoiceTools = {}) {}
  async start(getUrl: () => Promise<string>, firstMessage?: string): Promise<void> {
    if (this.starting || this.stopping || this.session) return;
    this.starting = true;
    const generation = ++this.generation;
    this.onState('connecting');
    try {
      const url = await getUrl();
      if (generation !== this.generation) return;
      const session = await this.agent.start(url, state => {
        if (generation !== this.generation) return;
        if (state === 'disconnected') { void this.stop().catch(() => {}); return; }
        this.onState(state);
      }, this.tools, firstMessage);
      if (generation !== this.generation) await session.endSession();
      else this.session = session;
    } catch (error) {
      if (generation !== this.generation) return;
      this.onState('disconnected');
      throw error;
    } finally {
      this.starting = false;
    }
  }
  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    ++this.generation;
    const session = this.session; this.session = undefined;
    try { await session?.endSession(); }
    finally { this.stopping = false; this.onState('disconnected'); }
  }
}
