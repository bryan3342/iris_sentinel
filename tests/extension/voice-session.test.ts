import { describe, expect, it, vi } from 'vitest';
import { VoiceController } from '../../extension/src/sidepanel/agent/session';
import type { VoiceSession } from '../../extension/src/sidepanel/agent/voice';

describe('voice session lifecycle', () => {
  it('does not connect after Stop while the signed URL is pending', async () => {
    let resolve!: (url: string) => void;
    const start = vi.fn();
    const controller = new VoiceController({ start }, vi.fn());
    const pending = controller.start(() => new Promise<string>(done => { resolve = done; }));
    await controller.stop(); resolve('unused'); await pending;
    expect(start).not.toHaveBeenCalled();
  });
  it('ends a connection that completes after Stop and rejects duplicate starts', async () => {
    let resolve!: (session: VoiceSession) => void;
    const endSession = vi.fn(async () => {});
    const start = vi.fn(() => new Promise<VoiceSession>(done => { resolve = done; }));
    const controller = new VoiceController({ start }, vi.fn());
    const pending = controller.start(async () => 'signed');
    await Promise.resolve();
    await controller.start(async () => 'duplicate');
    await controller.stop(); resolve({ endSession }); await pending;
    expect(start).toHaveBeenCalledTimes(1);
    expect(endSession).toHaveBeenCalledTimes(1);
  });
  it('ends active audio once and allows a new session after Stop', async () => {
    const endSession = vi.fn(async () => {});
    const start = vi.fn(async () => ({ endSession }));
    const controller = new VoiceController({ start }, vi.fn());
    await controller.start(async () => 'signed');
    await controller.stop(); await controller.stop();
    expect(endSession).toHaveBeenCalledTimes(1);
    await controller.start(async () => 'fresh');
    expect(start).toHaveBeenCalledTimes(2);
  });
  it('returns to disconnected after a failed start and allows retry', async () => {
    const onState = vi.fn(), endSession = vi.fn(async () => {});
    const start = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue({ endSession });
    const controller = new VoiceController({ start }, onState);
    await expect(controller.start(async () => 'signed')).rejects.toThrow('unavailable');
    expect(onState).toHaveBeenLastCalledWith('disconnected');
    await controller.start(async () => 'fresh');
    expect(start).toHaveBeenCalledTimes(2);
  });
  it('ignores a failed connection after Stop', async () => {
    let reject!: (error: Error) => void;
    const onState = vi.fn();
    const controller = new VoiceController({ start: () => new Promise((_resolve, fail) => { reject = fail; }) }, onState);
    const pending = controller.start(async () => 'signed');
    await Promise.resolve(); await controller.stop(); onState.mockClear();
    reject(new Error('late failure'));
    await expect(pending).resolves.toBeUndefined();
    expect(onState).not.toHaveBeenCalled();
  });
  it('rejects restarts while active audio is shutting down', async () => {
    let finish!: () => void;
    const endSession = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const start = vi.fn(async () => ({ endSession }));
    const controller = new VoiceController({ start }, vi.fn());
    await controller.start(async () => 'signed');
    const stopping = controller.stop();
    await controller.start(async () => 'too early');
    expect(start).toHaveBeenCalledTimes(1);
    finish(); await stopping;
    await controller.start(async () => 'fresh');
    expect(start).toHaveBeenCalledTimes(2);
  });
  it('ignores callbacks from an old session after restart', async () => {
    const callbacks: Array<(state: 'speaking' | 'disconnected') => void> = [];
    const onState = vi.fn();
    const controller = new VoiceController({ start: async (_url, callback) => {
      callbacks.push(callback); return { endSession: async () => {} };
    } }, onState);
    await controller.start(async () => 'first'); await controller.stop();
    await controller.start(async () => 'second'); onState.mockClear();
    callbacks[0]!('speaking'); callbacks[0]!('disconnected');
    expect(onState).not.toHaveBeenCalled();
    callbacks[1]!('speaking'); expect(onState).toHaveBeenLastCalledWith('speaking');
  });
  it('ends a session that disconnects before start resolves', async () => {
    const endSession = vi.fn(async () => {});
    const controller = new VoiceController({ start: async (_url, callback) => {
      callback('disconnected'); return { endSession };
    } }, vi.fn());
    await controller.start(async () => 'signed');
    expect(endSession).toHaveBeenCalledTimes(1);
  });
  it('hands the browser tools to the voice agent', async () => {
    const tools = { scroll_page: vi.fn(async () => 'Scrolled down.') };
    const start = vi.fn(async () => ({ endSession: vi.fn(async () => {}) }));
    await new VoiceController({ start }, vi.fn(), tools).start(async () => 'signed');
    expect(start).toHaveBeenCalledWith('signed', expect.any(Function), tools);
  });
});
