// Chrome native messaging framing. Every message is UTF-8 JSON preceded by its
// byte length as a 32-bit unsigned integer in native byte order. Iris only runs
// on little-endian machines (Apple Silicon, Windows x64), so the length is
// little-endian. Pure functions over Buffers, so they test without Chrome.
//
// Errors carry sizes only, never message content, since messages hold vitals.

/** Chrome refuses host-to-extension messages larger than 1 MB. */
export const MAX_MESSAGE_BYTES = 1024 * 1024;

const HEADER_BYTES = 4;

/** Thrown when a message cannot be framed or a frame cannot be read. */
export class FramingError extends Error {
  override name = 'FramingError';
}

/** Frames one message for stdout. Throws if it is not JSON or is over 1 MB. */
export function encodeMessage(message: unknown): Buffer {
  const json = JSON.stringify(message);
  if (json === undefined) throw new FramingError('Message is not JSON-serializable');
  const body = Buffer.from(json, 'utf8');
  if (body.length > MAX_MESSAGE_BYTES) {
    throw new FramingError(`Message is ${body.length} bytes; the limit is ${MAX_MESSAGE_BYTES}`);
  }
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * Reassembles messages from stdin chunks, which can split a frame anywhere or
 * hold several frames. Chrome may send up to 64 MiB, but Iris only sends small
 * control messages, so a frame over 1 MB is treated as a corrupt stream rather
 * than buffered. After an error the stream cannot be trusted: stop reading.
 */
export class FrameDecoder {
  private pending = Buffer.alloc(0);

  /** Adds a chunk and returns every message it completed, in order. */
  push(chunk: Buffer): unknown[] {
    this.pending = Buffer.concat([this.pending, chunk]);
    const messages: unknown[] = [];
    while (this.pending.length >= HEADER_BYTES) {
      const length = this.pending.readUInt32LE(0);
      if (length > MAX_MESSAGE_BYTES) {
        throw new FramingError(`Incoming frame announces ${length} bytes; the limit is ${MAX_MESSAGE_BYTES}`);
      }
      if (this.pending.length < HEADER_BYTES + length) break;
      const body = this.pending.subarray(HEADER_BYTES, HEADER_BYTES + length);
      this.pending = this.pending.subarray(HEADER_BYTES + length);
      messages.push(parse(body));
    }
    return messages;
  }
}

function parse(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    // The parser's own message quotes the text, so it is deliberately dropped.
    throw new FramingError('Incoming frame is not valid JSON');
  }
}
