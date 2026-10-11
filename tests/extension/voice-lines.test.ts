import { existsSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { playLine, VOICE_LINES } from '../../extension/src/sidepanel/agent/voice-lines';
import { handleVoiceMessage } from '../../extension/src/offscreen/handler';

let createDocument: ReturnType<typeof vi.fn>, sendMessage: ReturnType<typeof vi.fn>;
const played: string[] = [];
class FakeAudio extends EventTarget {
  constructor(readonly src: string) { super(); }
  async play() { played.push(this.src); queueMicrotask(() => this.dispatchEvent(new Event(this.src.includes('missing') ? 'error' : 'ended'))); }
}
beforeEach(() => {
  played.length = 0;
  createDocument = vi.fn(async () => {});
  sendMessage = vi.fn(async () => true);
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('chrome', {
    offscreen: { createDocument, Reason: { AUDIO_PLAYBACK: 'AUDIO_PLAYBACK' } },
    runtime: { id: 'iris', sendMessage, getURL: (path: string) => `chrome-extension://iris/${path}`, onMessage: { addListener: vi.fn() } },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('ships audio in the extension for every fixed line', () => {
  for (const name of Object.keys(VOICE_LINES)) expect(existsSync(new URL(`../../extension/public/voice/${name}.mp3`, import.meta.url))).toBe(true);
});

it('plays a line in the offscreen audio page, opening it if needed', async () => {
  expect(await playLine('ready')).toBe(true);
  expect(createDocument).toHaveBeenCalledWith(expect.objectContaining({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'] }));
  expect(sendMessage).toHaveBeenCalledWith({ target: 'offscreen', line: 'ready' });
  createDocument.mockRejectedValueOnce(new Error('Only a single offscreen document may be created.'));
  expect(await playLine('intro')).toBe(true); // already open
  sendMessage.mockRejectedValueOnce(new Error('Could not establish connection.'));
  expect(await playLine('intro')).toBe(false);
});

it('the audio page plays only a named line for the side panel, and answers once it has played', async () => {
  const panel = { id: 'iris', url: 'chrome-extension://iris/sidepanel.html' } as chrome.runtime.MessageSender;
  const answer = (message: unknown, sender = panel) => new Promise<boolean | 'ignored'>((done) => {
    if (!handleVoiceMessage(message, sender, done)) setTimeout(() => done('ignored'), 0);
  });
  expect(await answer({ target: 'offscreen', line: 'intro' })).toBe(true);
  expect(played).toEqual(['chrome-extension://iris/voice/intro.mp3']);
  expect(await answer({ target: 'offscreen', line: 'missing' })).toBe(false);
  expect(await answer({ target: 'offscreen', line: '../x' })).toBe(false);
  expect(await answer({ target: 'offscreen', line: 'intro' }, { id: 'iris', url: 'chrome-extension://iris/permission.html' } as chrome.runtime.MessageSender)).toBe(false);
  expect(await answer({ type: 'iris.voice.session' })).toBe('ignored'); // the broker's messages are not for this page
  expect(played).toHaveLength(2);
});
