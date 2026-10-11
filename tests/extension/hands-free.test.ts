import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HandsFree, QUIET_MS, type HandsFreeStatus } from '../../extension/src/sidepanel/agent/hands-free';
import type { VoiceAgent, VoiceState } from '../../extension/src/sidepanel/agent/voice';
import type { Mock } from 'vitest';

let level: ((db: number, t: number) => void) | null, stopListening: Mock<() => void>, voice: (state: VoiceState) => void;
let endSession: Mock<() => Promise<void>>, start: Mock<VoiceAgent['start']>, statuses: HandsFreeStatus[], t: number;

const listen = vi.fn(async (onLevel: (db: number, t: number) => void) => { level = onLevel; return stopListening; });
const make = (getUrl = async () => 'signed') => new HandsFree({ agent: { start }, tools: {}, getUrl, listen, onStatus: (s) => statuses.push(s), now: () => t });
const flush = () => vi.advanceTimersByTimeAsync(0);
/** Room quiet for a second, then the user talks for half a second. */
function speak() {
  for (let i = 0; i < 20; i++) level?.(-70, (t += 50));
  for (let i = 0; i < 10; i++) level?.(-30, (t += 50));
}

beforeEach(() => {
  vi.useFakeTimers();
  level = null; statuses = []; t = 0;
  stopListening = vi.fn<() => void>(() => { level = null; });
  endSession = vi.fn<() => Promise<void>>(async () => { voice('disconnected'); });
  start = vi.fn<VoiceAgent['start']>(async (_url, onState) => { voice = onState; onState('listening'); return { endSession }; });
  listen.mockClear();
});
afterEach(() => vi.useRealTimers());

it('listens locally, and connects the agent only once the user starts speaking', async () => {
  const handsFree = make();
  handsFree.setOn(true); await flush();
  expect(statuses.at(-1)).toEqual({ kind: 'waiting' });
  expect(start).not.toHaveBeenCalled();
  speak(); await flush();
  expect(stopListening).toHaveBeenCalledTimes(1); // local listening stops before the agent opens the microphone
  expect(start).toHaveBeenCalledWith('signed', expect.any(Function), {}, undefined, expect.any(Function)); // no greeting: the agent waits for the user
  expect(statuses.at(-1)).toEqual({ kind: 'talking', state: 'listening' });
});

it('hangs up after a minute of quiet and goes back to listening locally, but never while Iris speaks', async () => {
  const handsFree = make();
  handsFree.setOn(true); await flush(); speak(); await flush();
  voice('speaking'); t += QUIET_MS * 2; await vi.advanceTimersByTimeAsync(2_000);
  expect(endSession).not.toHaveBeenCalled();
  voice('listening'); t += QUIET_MS - 5_000; await vi.advanceTimersByTimeAsync(1_000);
  expect(endSession).not.toHaveBeenCalled();
  t += 5_000; await vi.advanceTimersByTimeAsync(1_000);
  expect(endSession).toHaveBeenCalledTimes(1);
  expect(listen).toHaveBeenCalledTimes(2);
  expect(statuses.at(-1)).toEqual({ kind: 'waiting' });
});

it('stops all microphone use when turned off', async () => {
  const handsFree = make();
  handsFree.setOn(true); await flush(); speak(); await flush();
  handsFree.setOn(false); await flush();
  expect(endSession).toHaveBeenCalledTimes(1);
  expect(statuses.at(-1)).toEqual({ kind: 'off' });
  expect(listen).toHaveBeenCalledTimes(1);
  handsFree.setOn(true); await flush(); handsFree.setOn(false);
  expect(stopListening).toHaveBeenCalledTimes(2);
});

it('waits for the person on a permission problem, and retries other failures after 30 s', async () => {
  const handsFree = make(async () => { throw new Error('GATEWAY_ACCESS'); });
  handsFree.setOn(true); await flush(); speak(); await flush();
  expect(statuses.at(-1)).toEqual({ kind: 'problem', code: 'GATEWAY_ACCESS' });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(listen).toHaveBeenCalledTimes(1);
  handsFree.retry(); await flush();
  expect(listen).toHaveBeenCalledTimes(2);

  const flaky = make(async () => { throw new Error('RATE_LIMITED'); });
  flaky.setOn(true); await flush(); speak(); await flush();
  expect(statuses.at(-1)).toEqual({ kind: 'problem', code: 'RATE_LIMITED' });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(statuses.at(-1)).toEqual({ kind: 'waiting' });
});

it('greets as soon as listening is up, with no speech needed, and later connections wait for the user', async () => {
  const handsFree = make();
  handsFree.setOn(true); handsFree.greet('Iris is ready.'); await flush();
  expect(start).toHaveBeenCalledWith('signed', expect.any(Function), {}, 'Iris is ready.', expect.any(Function));
  t += QUIET_MS; await vi.advanceTimersByTimeAsync(1_000); // hangs up, listens locally
  speak(); await flush();
  expect(start).toHaveBeenLastCalledWith('signed', expect.any(Function), {}, undefined, expect.any(Function));
});

it('keeps the greeting for when the problem is fixed, and drops it when turned off', async () => {
  let allowed = false;
  const handsFree = make(async () => { if (!allowed) throw new Error('GATEWAY_ACCESS'); return 'signed'; });
  handsFree.setOn(true); handsFree.greet('Hi'); await flush();
  expect(statuses.at(-1)).toEqual({ kind: 'problem', code: 'GATEWAY_ACCESS' });
  allowed = true; handsFree.retry(); await flush();
  expect(start).toHaveBeenLastCalledWith('signed', expect.any(Function), {}, 'Hi', expect.any(Function));

  const blocked = make(async () => { throw new Error('GATEWAY_ACCESS'); });
  blocked.setOn(true); blocked.greet('Hi'); await flush();
  blocked.setOn(false); blocked.setOn(true); await flush();
  expect(statuses.at(-1)).toEqual({ kind: 'waiting' }); // no greeting left to connect for
});
