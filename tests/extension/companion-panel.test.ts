// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { COMPANION_PROTOCOL_VERSION } from '@iris/protocol';
import { CompanionLink, type NativePort } from '../../extension/src/providers/companion/link';
import { companionPanel } from '../../extension/src/sidepanel/companion-status';

/** Stands in for Chrome's native messaging port. */
class FakePort implements NativePort {
  disconnected = false;
  private readonly messageListeners: ((message: unknown) => void)[] = [];
  readonly onMessage = { addListener: (listener: (message: unknown) => void) => void this.messageListeners.push(listener) };
  readonly onDisconnect = { addListener: () => {} };

  postMessage(): void {}

  disconnect(): void {
    this.disconnected = true;
  }

  /** The companion sends a message. */
  receive(message: unknown): void {
    this.messageListeners.forEach((listener) => listener(message));
  }
}

/**
 * Mounts the section on a real link whose ports are fakes, so each port stands
 * for one companion run. The link stamps messages with `clock`, which `advance` moves.
 */
function mount() {
  const ports: FakePort[] = [];
  let clock = 0;
  const link = new CompanionLink({
    connect: () => {
      const port = new FakePort();
      ports.push(port);
      return port;
    },
    lastError: () => undefined,
    now: () => clock,
  });
  const section = companionPanel(link);
  document.body.replaceChildren(section);
  const button = section.querySelector('button')!;
  const status = () => section.querySelector('[role=status]')!.textContent;
  const advance = (ms: number) => void (clock += ms);
  return { ports, button, status, section, advance };
}

const HELLO = { type: 'hello', version: COMPANION_PROTOCOL_VERSION };
const trusted = (value: number) => ({ value, confidence: 0.9, stable: true });

describe('body signals section', () => {
  it('does not start the companion when the panel opens', () => {
    const { ports, button, status } = mount();
    expect(ports).toHaveLength(0);
    expect(status()).toBe('Body signals: off.');
    expect(button.textContent).toBe('Start body signals');
  });

  it('starts the companion on Start and ends it on Stop', () => {
    const { ports, button, status } = mount();
    button.click();
    expect(ports).toHaveLength(1);
    ports[0]!.receive(HELLO);
    ports[0]!.receive({ type: 'status', state: 'running' });
    expect(status()).toBe('Body signals: measuring.');
    expect(button.textContent).toBe('Stop body signals');

    button.click();
    expect(ports[0]!.disconnected).toBe(true);
    expect(status()).toBe('Body signals: off.');
    expect(button.textContent).toBe('Start body signals');
  });

  it('starts a fresh companion when started again after a problem', () => {
    const { ports, button, status } = mount();
    button.click();
    ports[0]!.receive(HELLO);
    ports[0]!.receive({ type: 'status', state: 'credits-exhausted' });
    expect(status()).toContain('no Presage credit');
    expect(button.textContent).toBe('Start body signals');

    button.click();
    expect(ports[0]!.disconnected).toBe(true);
    expect(ports).toHaveLength(2);
    expect(status()).toBe('Body signals: connecting to the companion...');
  });

  it('graphs heart rate and breathing as trusted readings arrive, keeps the graph after Stop, and clears it on Start', () => {
    const { ports, button, section, advance } = mount();
    const graph = () => section.querySelector<HTMLElement>('figure.vitals-graph')!;
    button.click();
    ports[0]!.receive(HELLO);
    ports[0]!.receive({ type: 'status', state: 'running' });
    expect(graph().hidden).toBe(true);

    for (const pulse of [70, 71, 72]) {
      ports[0]!.receive({ type: 'vitals', pulse: trusted(pulse), breathing: trusted(14), hrv: null });
      advance(1000);
    }
    expect(graph().hidden).toBe(false);
    expect(graph().getAttribute('role')).toBe('img');
    expect(graph().getAttribute('aria-label')).toBe('Heart rate 70 to 72 beats a minute and breathing 14 breaths a minute, over the last 2 s.');
    expect(graph().querySelector('path.pulse')!.getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+(L[\d.]+,[\d.]+){2}$/);

    const note = () => section.querySelector<HTMLElement>('.note')!;
    button.click(); // Stop: the last session stays to look back on, still marked as estimates
    expect(graph().hidden).toBe(false);
    expect(note().hidden).toBe(false);
    expect(note().textContent).toBe('Estimates from the camera, not medical readings.');
    button.click(); // Start: a fresh session starts a fresh graph
    expect(graph().hidden).toBe(true);
    expect(note().hidden).toBe(true);
  });
});
