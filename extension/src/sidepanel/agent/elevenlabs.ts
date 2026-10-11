/// <reference types="vite/client" />
import { Conversation } from '@elevenlabs/client';
import rawAudioProcessor from '@elevenlabs/client/worklets/rawAudioProcessor.js?url&no-inline';
import audioConcatProcessor from '@elevenlabs/client/worklets/audioConcatProcessor.js?url&no-inline';
import type { VoiceAgent } from './voice';

/**
 * Audio goes directly to ElevenLabs. Iris's browser tools are offered as client tools: the agent
 * asks, Iris runs them in the browser and returns only their spoken answer, never a screenshot.
 * The microphone is muted while the agent speaks, so it hears the user only once it has finished:
 * no interrupting it, and its own voice from the speakers never reaches it as the user's. A reply to
 * words `heard` turns down is played silent instead, with the microphone left open for the user.
 */
export const elevenLabsVoice: VoiceAgent = {
  async start(signedUrl, onState, tools, firstMessage, heard) {
    let agentSpeaking = false;
    let ignoring = false; // the user's latest words are not acted on (see heard)
    let session: Awaited<ReturnType<typeof Conversation.startSession>> | undefined;
    const mic = () => session?.setMicMuted(agentSpeaking && !ignoring);
    session = await Conversation.startSession({
      signedUrl, connectionType: 'websocket',
      // The agent's own first message is empty, so it waits for the user unless Iris greets.
      ...(firstMessage ? { overrides: { agent: { firstMessage } } } : {}),
      workletPaths: { rawAudioProcessor, audioConcatProcessor },
      clientTools: tools,
      onConnect: () => onState('listening'),
      // The user's words arrive before any tool call they lead to, so `heard` decides first.
      onMessage: ({ role, message }) => {
        if (role !== 'user' || !heard) return;
        ignoring = !heard(message);
        session?.setVolume({ volume: ignoring ? 0 : 1 });
        mic();
      },
      onModeChange: ({ mode }) => {
        agentSpeaking = mode === 'speaking';
        mic();
        if (!ignoring) onState(mode);
      },
      onDisconnect: () => onState('disconnected'),
      // Never display or log upstream errors, which may contain credentials.
      onError: () => onState('disconnected'),
    });
    session.setMicMuted(agentSpeaking); // the agent may have started speaking before the session was returned
    return session;
  },
};
