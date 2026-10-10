export type VoiceState = 'connecting' | 'listening' | 'speaking' | 'disconnected';
export interface VoiceSession { endSession(): Promise<void> }
/** Browser actions the voice agent may call, by name. Each answers in words the agent can say. */
export type VoiceTools = Record<string, (parameters: Record<string, unknown>) => Promise<string>>;
export interface VoiceAgent {
  start(signedUrl: string, onState: (state: VoiceState) => void, tools: VoiceTools): Promise<VoiceSession>;
}
