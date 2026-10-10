export type VoiceState = 'connecting' | 'listening' | 'speaking' | 'disconnected';
export interface VoiceSession { endSession(): Promise<void> }
export interface VoiceAgent {
  start(signedUrl: string, onState: (state: VoiceState) => void): Promise<VoiceSession>;
}
