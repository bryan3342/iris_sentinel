import { broker } from '../../page-understanding/coordinator';
import { GATEWAY } from '../../page-understanding/gateway';
import { openMicrophone } from '../setup/microphone';
import { elevenLabsVoice } from './elevenlabs';
import { VoiceController } from './session';

export function conversationPanel(): HTMLElement {
  const panel = document.createElement('section');
  const title = document.createElement('h2'); title.textContent = 'Talk to Iris';
  const notice = document.createElement('p');
  notice.textContent = 'Start sends microphone audio to ElevenLabs for conversation and plays its replies. Stop or close this panel to end the conversation. Voice browser actions are not connected yet.';
  const start = document.createElement('button'); start.textContent = 'Start conversation';
  const stop = document.createElement('button'); stop.textContent = 'Stop conversation'; stop.disabled = true;
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  status.textContent = 'Conversation off.';
  let closed = false;
  let pending = false, active = false;
  const controller = new VoiceController(elevenLabsVoice, state => {
    active = state !== 'disconnected';
    start.disabled = pending || active;
    status.textContent = { connecting: 'Connecting...', listening: 'Iris is listening.', speaking: 'Iris is speaking.', disconnected: 'Conversation off.' }[state];
    stop.disabled = state === 'disconnected';
  });
  start.addEventListener('click', () => {
    pending = true;
    start.disabled = true;
    void controller.start(async () => {
      if (!await chrome.permissions.request({ origins: [`${GATEWAY}/*`] })) throw new Error('GATEWAY_ACCESS');
      const stream = await openMicrophone(); stream.getTracks().forEach(track => track.stop());
      const value = await broker({ type: 'iris.voice.session' }) as { signedUrl: string };
      return value.signedUrl;
    }).catch(async error => {
      if (closed) return;
      const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'VOICE_UNAVAILABLE';
      status.textContent = `${code}. Check microphone permission, the local server and ElevenLabs setup, then try again.`;
    }).finally(() => { pending = false; if (!closed) start.disabled = active; });
  });
  stop.addEventListener('click', () => {
    void controller.stop().catch(() => { status.textContent = 'Could not stop cleanly. Close the panel.'; });
  });
  addEventListener('pagehide', () => { closed = true; void controller.stop().catch(() => {}); }, { once: true });
  panel.append(title, notice, start, stop, status);
  return panel;
}
