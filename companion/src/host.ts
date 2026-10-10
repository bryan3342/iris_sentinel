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
// stdin and stdout. The streams are passed in so tests can drive the loop
// without Chrome.

export interface HostOptions {
  input: Readable;
  output: Writable;
  /** Origin Chrome passed as the first argument, such as `chrome-extension://<id>/`. */
  callerOrigin: string | undefined;
  /** Diagnostics only (stderr in the real program). Never given message content. */
  log: (line: string) => void;
}

/** True only for the Iris extension, the one caller the companion answers. */
export function isIrisCaller(origin: string | undefined): boolean {
  return origin === `chrome-extension://${IRIS_EXTENSION_ID}/`;
}

/**
 * Says hello, then answers messages until Chrome closes the connection.
 * Resolves with the exit code: 0 when the input ends, 1 for an unknown caller,
 * a corrupt stream or a stream error.
 */
export function runHost({ input, output, callerOrigin, log }: HostOptions): Promise<number> {
  if (!isIrisCaller(callerOrigin)) {
    log(`refusing caller ${callerOrigin ?? '(none)'}: only the Iris extension may connect`);
    return Promise.resolve(1);
  }
  const send = (message: FromCompanion) => output.write(encodeMessage(message));
  const decoder = new FrameDecoder();
  send({ type: 'hello', version: COMPANION_PROTOCOL_VERSION });

  return new Promise((resolve) => {
    input.on('data', (chunk: Buffer) => {
      let values: unknown[];
      try {
        values = decoder.push(chunk);
      } catch (error) {
        // Framing errors carry sizes only, so they are safe to log.
        log(`input is corrupt, exiting: ${error instanceof FramingError ? error.message : 'unknown error'}`);
        input.destroy();
        resolve(1);
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
        handle(message, send);
      }
    });
    input.on('end', () => resolve(0));
    input.on('close', () => resolve(0));
    input.on('error', () => resolve(1));
  });
}

function handle(message: ToCompanion, send: (message: FromCompanion) => void): void {
  switch (message.type) {
    case 'start':
    case 'stop':
      // No body signals until the Presage session is wired in, so the honest
      // answer to both is "stopped".
      send({ type: 'status', state: 'stopped' });
      break;
  }
}
