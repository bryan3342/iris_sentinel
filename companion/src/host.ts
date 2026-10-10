import type { Readable, Writable } from 'node:stream';
import {
  COMPANION_PROTOCOL_VERSION,
  type FromCompanion,
  IRIS_EXTENSION_ID,
  type ToCompanion,
  validateToCompanion,
} from '@iris/protocol';
import { encodeMessage, FrameDecoder, FramingError } from './messaging/framing';

// The companion's message loop. Chrome starts the companion when the extension
// connects, passes the caller's origin as the first argument, and talks over
// stdin and stdout. The streams and the sensing are passed in so tests can
// drive the loop without Chrome, a camera or Presage.

/** What the host runs while the extension wants body signals: Presage, or a fake in tests. */
export interface Sensing {
  /** Starts measuring, reporting through `send`. Does nothing while already started. */
  start(send: (message: FromCompanion) => void): void;
  /** Stops measuring and releases the camera. Safe to call when not started. */
  stop(): Promise<void>;
}

export interface HostOptions {
  input: Readable;
  output: Writable;
  /** Origin Chrome passed as the first argument, such as `chrome-extension://<id>/`. */
  callerOrigin: string | undefined;
  sensing: Sensing;
  /** Diagnostics only (stderr in the real program). Never given message content. */
  log: (line: string) => void;
}

/** True only for the Iris extension, the one caller the companion answers. */
export function isIrisCaller(origin: string | undefined): boolean {
  return origin === `chrome-extension://${IRIS_EXTENSION_ID}/`;
}

/**
 * Says hello, then answers messages until Chrome closes the connection.
 * Sensing is always stopped before the returned promise settles. Resolves with
 * the exit code: 0 when the input ends, 1 for an unknown caller, a corrupt
 * stream or a stream error.
 */
export function runHost({ input, output, callerOrigin, sensing, log }: HostOptions): Promise<number> {
  if (!isIrisCaller(callerOrigin)) {
    log(`refusing caller ${callerOrigin ?? '(none)'}: only the Iris extension may connect`);
    return Promise.resolve(1);
  }
  const send = (message: FromCompanion) => output.write(encodeMessage(message));
  const decoder = new FrameDecoder();
  send({ type: 'hello', version: COMPANION_PROTOCOL_VERSION });

  return new Promise((resolve) => {
    let exiting = false;
    const exit = (code: number) => {
      if (exiting) return;
      exiting = true;
      void sensing.stop().finally(() => resolve(code));
    };
    input.on('data', (chunk: Buffer) => {
      let values: unknown[];
      try {
        values = decoder.push(chunk);
      } catch (error) {
        // Framing errors carry sizes only, so they are safe to log.
        log(`input is corrupt, exiting: ${error instanceof FramingError ? error.message : 'unknown error'}`);
        input.destroy();
        exit(1);
        return;
      }
      for (const value of values) {
        let message: ToCompanion;
        try {
          message = validateToCompanion(value);
        } catch {
          log('dropped a message that does not match the protocol');
          continue;
        }
        if (message.type === 'start') sensing.start(send);
        else void sensing.stop().then(() => send({ type: 'status', state: 'stopped' }));
      }
    });
    input.on('end', () => exit(0));
    input.on('close', () => exit(0));
    input.on('error', () => exit(1));
    // Chrome closing its end while a message is on the way (EPIPE) lands here,
    // so the companion exits instead of crashing on an unhandled error.
    output.on('error', () => {
      log('output closed, exiting');
      exit(1);
    });
  });
}
