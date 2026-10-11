export type VoiceState = 'connecting' | 'listening' | 'speaking' | 'disconnected';
export interface VoiceSession { endSession(): Promise<void> }
/** Browser actions the voice agent may call, by name. Each answers in words the agent can say. */
export type VoiceTools = Record<string, (parameters: Record<string, unknown>) => Promise<string>>;
/** Takes each request the agent hears, in the user's words, and says whether to act on it. */
export type Heard = (said: string) => boolean;
export interface VoiceAgent {
  /**
   * `firstMessage`, when given, is what the agent says on connecting; otherwise it waits for the user.
   * `heard`, when given, decides on each request: the agent's reply to one not acted on is silent, does
   * not count as speaking, and leaves the microphone open.
   */
  start(signedUrl: string, onState: (state: VoiceState) => void, tools: VoiceTools, firstMessage?: string, heard?: Heard): Promise<VoiceSession>;
}
