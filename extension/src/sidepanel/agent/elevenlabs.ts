/// <reference types="vite/client" />
import { Conversation } from '@elevenlabs/client';
import rawAudioProcessor from '@elevenlabs/client/worklets/rawAudioProcessor.js?url&no-inline';
import audioConcatProcessor from '@elevenlabs/client/worklets/audioConcatProcessor.js?url&no-inline';
import type { VoiceAgent } from './voice';

/** Audio goes directly to ElevenLabs; no page content or browser tools are supplied. */
export const elevenLabsVoice: VoiceAgent = {
  async start(signedUrl, onState) {
    return Conversation.startSession({
      signedUrl, connectionType: 'websocket',
      workletPaths: { rawAudioProcessor, audioConcatProcessor },
      onConnect: () => onState('listening'),
      onModeChange: ({ mode }) => onState(mode),
      onDisconnect: () => onState('disconnected'),
      // Never display or log upstream errors, which may contain credentials.
      onError: () => onState('disconnected'),
    });
  },
};
