import {
  type BlinkEvent,
  COMPANION_PROTOCOL_VERSION,
  type CompanionState,
  type FaceProvider,
  type FromCompanion,
  NATIVE_HOST_NAME,
  type QualityStatus,
  type Unsubscribe,
  validateFromCompanion,
  type VitalsProvider,
  type VitalsSample,
} from '@iris/protocol';

// The side panel's connection to the Presage companion over Chrome native
// messaging. Chrome starts the companion when the link connects and ends it
// when the port closes, which happens on its own when the side panel closes,
// so Presage only runs while Iris is open. Every message is validated, and
// events are stamped with the side panel's clock when they arrive.

/** How the connection is doing, apart from what the companion itself reports. */
export type LinkState =
  /** Not started. */
  | 'idle'
  /** No native messaging here, as in the localhost playground. */
  | 'unavailable'
  /** Waiting for the companion's hello. */
  | 'connecting'
  /** Hello received with a matching protocol version. */
  | 'connected'
  /** Chrome cannot find the companion, or it is registered for another extension. */
  | 'not-installed'
  /** The companion speaks another protocol version. */
  | 'outdated'
  /** The companion exited or the connection dropped. */
  | 'disconnected';

/** The part of chrome.runtime.Port the link uses, so tests can pass a fake. */
export interface NativePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export interface CompanionLinkOptions {
  /** Opens the native port, or null where native messaging is unavailable. */
  connect: (() => NativePort) | null;
  /** Chrome's reason for the last disconnect, read inside the disconnect handler. */
  lastError: () => string | undefined;
  /** Monotonic clock in milliseconds for stamping events. */
  now?: () => number;
}

/** Chrome's errors that mean "install or reinstall the companion". */
const INSTALL_ERRORS = new Set([
  'Specified native messaging host not found.',
  'Access to the specified native messaging host is forbidden.',
]);

export class CompanionLink implements FaceProvider, VitalsProvider {
  private port: NativePort | null = null;
  private current: LinkState = 'idle';
  private readonly now: () => number;
  private readonly stateListeners = new Set<(state: LinkState) => void>();
  private readonly statusListeners = new Set<(state: CompanionState) => void>();
  private readonly qualityListeners = new Set<(status: QualityStatus) => void>();
  private readonly vitalsListeners = new Set<(sample: VitalsSample) => void>();
  private readonly blinkListeners = new Set<(blink: BlinkEvent) => void>();

  constructor(private readonly options: CompanionLinkOptions) {
    this.now = options.now ?? (() => performance.now());
  }

  get state(): LinkState {
    return this.current;
  }

  /** Connects; once the companion says hello, asks it to start sensing. Does nothing while already linked. */
  async start(): Promise<void> {
    if (this.port) return;
    if (!this.options.connect) {
      this.setState('unavailable');
      return;
    }
    const port = this.options.connect();
    this.port = port;
    this.setState('connecting');
    port.onMessage.addListener((raw) => this.receive(port, raw));
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      this.port = null;
      const reason = this.options.lastError();
      this.setState(reason !== undefined && INSTALL_ERRORS.has(reason) ? 'not-installed' : 'disconnected');
    });
  }

  /** Closes the connection, which ends the companion and Presage with it. */
  stop(): void {
    const port = this.port;
    if (!port) return;
    this.port = null;
    port.disconnect();
    this.setState('idle');
  }

  onState(listener: (state: LinkState) => void): Unsubscribe {
    return subscribe(this.stateListeners, listener);
  }

  /** What the companion reports it is doing, such as running or key-missing. */
  onStatus(listener: (state: CompanionState) => void): Unsubscribe {
    return subscribe(this.statusListeners, listener);
  }

  onQuality(listener: (status: QualityStatus) => void): Unsubscribe {
    return subscribe(this.qualityListeners, listener);
  }

  onVitals(listener: (sample: VitalsSample) => void): Unsubscribe {
    return subscribe(this.vitalsListeners, listener);
  }

  onBlink(listener: (blink: BlinkEvent) => void): Unsubscribe {
    return subscribe(this.blinkListeners, listener);
  }

  private receive(port: NativePort, raw: unknown): void {
    if (this.port !== port) return;
    let message: FromCompanion;
    try {
      message = validateFromCompanion(raw);
    } catch {
      return; // Dropped without logging: it may hold vitals.
    }
    if (message.type === 'hello') {
      if (message.version !== COMPANION_PROTOCOL_VERSION) {
        this.port = null;
        port.disconnect();
        this.setState('outdated');
        return;
      }
      this.setState('connected');
      port.postMessage({ type: 'start' });
      return;
    }
    if (this.current !== 'connected') return; // Nothing counts before a matching hello.
    const t = this.now();
    switch (message.type) {
      case 'status':
        this.statusListeners.forEach((listener) => listener(message.state));
        break;
      case 'quality':
        this.qualityListeners.forEach((listener) => listener({ t, quality: message.quality, hint: message.hint }));
        break;
      case 'vitals': {
        const sample = { t, pulse: message.pulse, breathing: message.breathing, hrv: message.hrv };
        this.vitalsListeners.forEach((listener) => listener(sample));
        break;
      }
      case 'blink':
        this.blinkListeners.forEach((listener) => listener({ t, durationMs: message.durationMs }));
        break;
    }
  }

  private setState(state: LinkState): void {
    this.current = state;
    this.stateListeners.forEach((listener) => listener(state));
  }
}

/** The real link: native messaging inside the extension, unavailable in the localhost playground. */
export function companionLink(): CompanionLink {
  const runtime = typeof chrome === 'undefined' ? undefined : chrome.runtime;
  return new CompanionLink({
    connect: runtime?.connectNative ? () => runtime.connectNative(NATIVE_HOST_NAME) : null,
    lastError: () => runtime?.lastError?.message,
  });
}

function subscribe<T>(listeners: Set<(value: T) => void>, listener: (value: T) => void): Unsubscribe {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
