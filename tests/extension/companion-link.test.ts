import { describe, expect, it } from 'vitest';
import { COMPANION_PROTOCOL_VERSION } from '@iris/protocol';
import type { BlinkEvent, CompanionState, QualityStatus, VitalsSample } from '@iris/protocol';
import { CompanionLink, type LinkState, type NativePort } from '../../extension/src/providers/companion/link';

/** Stands in for Chrome's native messaging port. */
class FakePort implements NativePort {
  readonly sent: unknown[] = [];
  disconnected = false;
  private readonly messageListeners: ((message: unknown) => void)[] = [];
  private readonly disconnectListeners: (() => void)[] = [];
  readonly onMessage = { addListener: (listener: (message: unknown) => void) => void this.messageListeners.push(listener) };
  readonly onDisconnect = { addListener: (listener: () => void) => void this.disconnectListeners.push(listener) };

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  /** The companion sends a message. */
  receive(message: unknown): void {
    this.messageListeners.forEach((listener) => listener(message));
  }

  /** Chrome reports the connection closed. */
  close(): void {
    this.disconnectListeners.forEach((listener) => listener());
  }
}

const HELLO = { type: 'hello', version: COMPANION_PROTOCOL_VERSION };
const steady = { value: 72, confidence: 0.9, stable: true };

function setup({ native = true }: { native?: boolean } = {}) {
  const ports: FakePort[] = [];
  const chrome = { lastError: undefined as string | undefined };
  const link = new CompanionLink({
    connect: native
      ? () => {
          const port = new FakePort();
          ports.push(port);
          return port;
        }
      : null,
    lastError: () => chrome.lastError,
    now: () => 1234,
  });
  const states: LinkState[] = [];
  link.onState((state) => states.push(state));
  return { link, ports, chrome, states, port: () => ports.at(-1)! };
}

describe('CompanionLink', () => {
  it('is unavailable where there is no native messaging', async () => {
    const { link } = setup({ native: false });
    await link.start();
    expect(link.state).toBe('unavailable');
  });

  it('connects, waits for hello, then asks the companion to start', async () => {
    const { link, port } = setup();
    await link.start();
    expect(link.state).toBe('connecting');
    expect(port().sent).toEqual([]);
    port().receive(HELLO);
    expect(link.state).toBe('connected');
    expect(port().sent).toEqual([{ type: 'start' }]);
  });

  it('refuses a companion that speaks another protocol version', async () => {
    const { link, port } = setup();
    await link.start();
    port().receive({ type: 'hello', version: COMPANION_PROTOCOL_VERSION + 1 });
    expect(link.state).toBe('outdated');
    expect(port().disconnected).toBe(true);
    expect(port().sent).toEqual([]);
  });

  it('passes on body signals and companion status, stamped with the side panel clock', async () => {
    const { link, port } = setup();
    const vitals: VitalsSample[] = [];
    const quality: QualityStatus[] = [];
    const blinks: BlinkEvent[] = [];
    const status: CompanionState[] = [];
    link.onVitals((sample) => vitals.push(sample));
    link.onQuality((value) => quality.push(value));
    link.onBlink((blink) => blinks.push(blink));
    link.onStatus((state) => status.push(state));
    await link.start();
    port().receive(HELLO);
    port().receive({ type: 'status', state: 'key-missing' });
    port().receive({ type: 'vitals', pulse: steady, breathing: null, hrv: null });
    port().receive({ type: 'quality', quality: 'too-dark', hint: 'Add more light' });
    port().receive({ type: 'blink', durationMs: 167 });
    expect(status).toEqual(['key-missing']);
    expect(vitals).toEqual([{ t: 1234, pulse: steady, breathing: null, hrv: null }]);
    expect(quality).toEqual([{ t: 1234, quality: 'too-dark', hint: 'Add more light' }]);
    expect(blinks).toEqual([{ t: 1234, durationMs: 167 }]);
  });

  it('ignores signals before hello and messages that break the protocol', async () => {
    const { link, port } = setup();
    const vitals: VitalsSample[] = [];
    link.onVitals((sample) => vitals.push(sample));
    await link.start();
    port().receive({ type: 'vitals', pulse: steady, breathing: null, hrv: null });
    port().receive(HELLO);
    port().receive({ type: 'talking', on: true });
    port().receive({ type: 'vitals', pulse: { value: -1, confidence: 2, stable: true }, breathing: null, hrv: null });
    expect(vitals).toEqual([]);
    expect(link.state).toBe('connected');
  });

  it('says not installed when Chrome cannot find the companion', async () => {
    const { link, port, chrome } = setup();
    await link.start();
    chrome.lastError = 'Specified native messaging host not found.';
    port().close();
    expect(link.state).toBe('not-installed');
  });

  it('says disconnected when the companion exits', async () => {
    const { link, port, chrome } = setup();
    await link.start();
    port().receive(HELLO);
    chrome.lastError = 'Native host has exited.';
    port().close();
    expect(link.state).toBe('disconnected');
  });

  it('keeps one connection when started twice', async () => {
    const { link, ports } = setup();
    await link.start();
    await link.start();
    expect(ports).toHaveLength(1);
  });

  it('closes the connection on stop, and opens a new one on the next start', async () => {
    const { link, ports, states } = setup();
    await link.start();
    ports[0]!.receive(HELLO);
    link.stop();
    expect(ports[0]!.disconnected).toBe(true);
    expect(link.state).toBe('idle');
    await link.start();
    expect(ports).toHaveLength(2);
    expect(states).toEqual(['connecting', 'connected', 'idle', 'connecting']);
  });
});
