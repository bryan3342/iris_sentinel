import { addressedToIris, SpeechGate } from '@iris/core';
import { VoiceController } from './session';
import type { VoiceAgent, VoiceState, VoiceTools } from './voice';

export type HandsFreeStatus =
  | { kind: 'off' }
  | { kind: 'waiting' } // hearing loudness on the laptop only, nothing sent
  | { kind: 'connecting' }
  | { kind: 'talking'; state: 'listening' | 'speaking' }
  | { kind: 'problem'; code: string };

export interface HandsFreeDeps {
  agent: VoiceAgent;
  tools: VoiceTools;
  getUrl: () => Promise<string>;
  /** Reports microphone loudness until the returned function is called (see mic-level.ts). */
  listen: (onLevel: (db: number, t: number) => void) => Promise<() => void>;
  onStatus: (status: HandsFreeStatus) => void;
  /** Told whenever the room turns loud or quiet again; in a loud room Iris acts only on requests addressed to it. */
  onLoudRoom?: (loud: boolean) => void;
  gate?: SpeechGate;
  now?: () => number;
}

/** A conversation ends after this long with neither side speaking. */
export const QUIET_MS = 60_000;
const RETRY_MS = 30_000;
/** Problems only the person can fix (a permission, a click); listening resumes on retry(). */
const NEEDS_PERSON = new Set(['MICROPHONE', 'AUDIO_BLOCKED', 'GATEWAY_ACCESS']);
/** What a tool answers, without running, to a request not addressed to Iris in a loud room. */
const NOT_FOR_IRIS = 'Not done: the room is loud, so Iris acts only on requests addressed to it, such as "Hey Iris, scroll down". Say nothing.';

/**
 * Hands-free voice: while on, Iris hears only loudness on the laptop. When the user starts
 * speaking it connects the voice agent (only then does audio go to ElevenLabs), and after a minute
 * of quiet it hangs up and goes back to listening locally. One microphone user at a time: local
 * listening stops before the agent opens the microphone. Turning it off stops all microphone use.
 * In a loud room (see SpeechGate.loud) Iris acts only on requests addressed to it (see
 * addressedToIris): any other runs no tool, and the agent's reply to it is silent, so voices around
 * the user do nothing. The user's own requests keep the conversation open; other voices do not.
 */
export class HandsFree {
  private on = false;
  private loud = false; // the room as last heard; it is not measured during a conversation
  private ignoring = false; // the latest request was not addressed to Iris in a loud room
  private phase: 'off' | 'idle' | 'waiting' | 'connecting' | 'connected' | 'problem' = 'off';
  private generation = 0;
  private stopListening: (() => void) | null = null;
  private greeting: string | null = null; // said on the next connection, which then needs no speech
  private mode: VoiceState = 'disconnected';
  private lastActive = 0;
  private quietTimer?: ReturnType<typeof setInterval>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private readonly controller: VoiceController;
  private readonly gate: SpeechGate;
  private readonly now: () => number;

  constructor(private readonly deps: HandsFreeDeps) {
    this.gate = deps.gate ?? new SpeechGate();
    this.now = deps.now ?? (() => Date.now());
    // Checked here, not left to the agent: a request not addressed to Iris in a loud room runs nothing.
    const tools: VoiceTools = Object.fromEntries(Object.entries(deps.tools).map(([name, run]) =>
      [name, async (parameters: Record<string, unknown>) => (this.ignoring ? NOT_FOR_IRIS : run(parameters))]));
    this.controller = new VoiceController(deps.agent, (state) => this.onVoice(state), tools, (said) => {
      this.ignoring = this.loud && !addressedToIris(said);
      // The user's own requests keep the conversation open, even when Iris answers them silently.
      if (!this.ignoring) this.lastActive = this.now();
      return !this.ignoring;
    });
  }

  setOn(on: boolean): void {
    this.on = on;
    if (on) void this.resume();
    else this.halt();
  }

  /** A conversation is connecting or open. */
  get talking(): boolean {
    return this.phase === 'connecting' || this.phase === 'connected';
  }

  /** Connects as soon as listening is up, without waiting for speech, and has the agent say `message`. */
  greet(message: string): void {
    this.greeting = message;
    if (this.phase === 'waiting' && this.stopListening) void this.connect();
  }

  /** Tries again after the person fixed what stopped listening. */
  retry(): void {
    if (this.on && this.phase === 'problem') void this.resume();
  }

  private async resume(): Promise<void> {
    clearTimeout(this.retryTimer);
    if (!this.on || ['waiting', 'connecting', 'connected'].includes(this.phase)) return;
    this.phase = 'waiting';
    const mine = ++this.generation;
    this.gate.reset();
    try {
      const stop = await this.deps.listen((db, t) => {
        const speaking = this.gate.update(db, t);
        this.room(this.gate.loud);
        if (speaking) void this.connect();
      });
      if (mine !== this.generation || this.phase !== 'waiting') return stop();
      this.stopListening = stop;
      this.deps.onStatus({ kind: 'waiting' });
      if (this.greeting !== null) void this.connect();
    } catch (error) {
      if (mine === this.generation) this.problem(error);
    }
  }

  private async connect(): Promise<void> {
    if (this.phase !== 'waiting') return;
    this.phase = 'connecting';
    this.stopListening?.();
    this.stopListening = null;
    this.deps.onStatus({ kind: 'connecting' });
    const mine = this.generation;
    const greeting = this.greeting ?? undefined;
    this.greeting = null;
    this.ignoring = false;
    try {
      await this.controller.start(this.deps.getUrl, greeting);
    } catch (error) {
      if (mine !== this.generation) return;
      if (greeting !== undefined) this.greeting ??= greeting; // greet once it works
      this.problem(error);
      return;
    }
    // Started without ever connecting (it closed at once): listen again.
    if (mine === this.generation && this.phase === 'connecting') { this.phase = 'idle'; void this.resume(); }
  }

  private onVoice(state: VoiceState): void {
    if (state === 'connecting') return;
    if (state === 'disconnected') {
      clearInterval(this.quietTimer);
      if (this.phase === 'connected') { this.phase = 'idle'; void this.resume(); }
      return;
    }
    this.mode = state;
    this.lastActive = this.now();
    if (this.phase === 'connecting') {
      this.phase = 'connected';
      this.quietTimer = setInterval(() => {
        if (this.mode === 'listening' && this.now() - this.lastActive >= QUIET_MS) void this.controller.stop().catch(() => {});
      }, 1_000);
    }
    this.deps.onStatus({ kind: 'talking', state });
  }

  private problem(error: unknown): void {
    const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'VOICE_UNAVAILABLE';
    this.phase = 'problem';
    this.deps.onStatus({ kind: 'problem', code });
    if (!NEEDS_PERSON.has(code)) this.retryTimer = setTimeout(() => this.retry(), RETRY_MS);
  }

  private halt(): void {
    this.generation++;
    this.greeting = null;
    this.phase = 'off';
    clearTimeout(this.retryTimer);
    clearInterval(this.quietTimer);
    this.stopListening?.();
    this.stopListening = null;
    void this.controller.stop().catch(() => {});
    this.room(false); // not listening: the room is no longer heard
    this.deps.onStatus({ kind: 'off' });
  }

  private room(loud: boolean): void {
    if (loud === this.loud) return;
    this.loud = loud;
    this.deps.onLoudRoom?.(loud);
  }
}
