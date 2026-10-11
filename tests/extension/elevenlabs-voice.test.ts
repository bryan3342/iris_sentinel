import { beforeEach, expect, it, vi } from 'vitest';

type Options = { onModeChange: (change: { mode: 'speaking' | 'listening' }) => void; overrides?: unknown };
const session = { setMicMuted: vi.fn(), endSession: vi.fn() };
let options: Options;
let speakFirst = false;
vi.mock('@elevenlabs/client', () => ({
  Conversation: {
    startSession: vi.fn(async (given: Options) => {
      options = given;
      if (speakFirst) given.onModeChange({ mode: 'speaking' }); // a check-in starts speaking while connecting
      return session;
    }),
  },
}));
const { elevenLabsVoice } = await import('../../extension/src/sidepanel/agent/elevenlabs');

beforeEach(() => { session.setMicMuted.mockClear(); speakFirst = false; });

it('mutes the microphone while the agent speaks, so it hears the user only once it has finished', async () => {
  const states: string[] = [];
  await elevenLabsVoice.start('wss://signed', (s) => states.push(s), {});
  expect(session.setMicMuted).toHaveBeenLastCalledWith(false);
  options.onModeChange({ mode: 'speaking' });
  expect(session.setMicMuted).toHaveBeenLastCalledWith(true);
  options.onModeChange({ mode: 'listening' });
  expect(session.setMicMuted).toHaveBeenLastCalledWith(false);
  expect(states).toEqual(['speaking', 'listening']);
});

it('keeps the microphone muted when the agent starts speaking before the session is returned', async () => {
  speakFirst = true;
  await elevenLabsVoice.start('wss://signed', () => {}, {}, 'Want a hand, or a short break?');
  expect(session.setMicMuted).toHaveBeenLastCalledWith(true);
  expect(options.overrides).toEqual({ agent: { firstMessage: 'Want a hand, or a short break?' } });
});
