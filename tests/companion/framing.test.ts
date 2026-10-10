import { describe, expect, it } from 'vitest';
import { encodeMessage, FrameDecoder, FramingError, MAX_MESSAGE_BYTES } from '../../companion/src/messaging/framing';

/** A raw frame around any bytes, for inputs encodeMessage would never produce. */
function frameOf(body: Buffer, length = body.length): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(length, 0);
  return Buffer.concat([header, body]);
}

function decodeAll(...chunks: Buffer[]): unknown[] {
  const decoder = new FrameDecoder();
  return chunks.flatMap((chunk) => decoder.push(chunk));
}

describe('encodeMessage', () => {
  it('prefixes the JSON with its byte length, little-endian', () => {
    const frame = encodeMessage({ type: 'hello' });
    expect(frame.readUInt32LE(0)).toBe('{"type":"hello"}'.length);
    expect(frame.subarray(4).toString('utf8')).toBe('{"type":"hello"}');
  });

  it('counts bytes, not characters, for non-ASCII text', () => {
    const json = JSON.stringify({ hint: 'Move closer, é 👋' });
    expect(encodeMessage({ hint: 'Move closer, é 👋' }).readUInt32LE(0)).toBe(Buffer.byteLength(json));
    expect(Buffer.byteLength(json)).toBeGreaterThan(json.length);
  });

  it('accepts a message of exactly 1 MB and refuses one byte more', () => {
    // A JSON string adds a quote on each side of its text.
    expect(encodeMessage('a'.repeat(MAX_MESSAGE_BYTES - 2))).toHaveLength(4 + MAX_MESSAGE_BYTES);
    expect(() => encodeMessage('a'.repeat(MAX_MESSAGE_BYTES - 1))).toThrow(FramingError);
  });

  it('refuses values that are not JSON', () => {
    expect(() => encodeMessage(undefined)).toThrow(FramingError);
  });
});

describe('FrameDecoder', () => {
  it('reads back what encodeMessage wrote', () => {
    expect(decodeAll(encodeMessage({ type: 'start', v: 1 }))).toEqual([{ type: 'start', v: 1 }]);
  });

  it('reads several messages from one chunk, in order', () => {
    const chunk = Buffer.concat([encodeMessage({ n: 1 }), encodeMessage({ n: 2 }), encodeMessage({ n: 3 })]);
    expect(decodeAll(chunk)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it('waits for the rest of a split message, even when the split is inside the length', () => {
    const frame = encodeMessage({ type: 'stop' });
    const decoder = new FrameDecoder();
    expect(decoder.push(frame.subarray(0, 2))).toEqual([]);
    expect(decoder.push(frame.subarray(2, 9))).toEqual([]);
    expect(decoder.push(frame.subarray(9))).toEqual([{ type: 'stop' }]);
  });

  it('handles a stream fed one byte at a time, including multi-byte characters', () => {
    const stream = Buffer.concat([encodeMessage({ a: 'é' }), encodeMessage([1, 2])]);
    expect(decodeAll(...[...stream].map((byte) => Buffer.from([byte])))).toEqual([{ a: 'é' }, [1, 2]]);
  });

  it('rejects a frame announcing more than 1 MB without waiting for its body', () => {
    expect(() => new FrameDecoder().push(frameOf(Buffer.alloc(0), MAX_MESSAGE_BYTES + 1))).toThrow(FramingError);
  });

  it('rejects a frame that is not JSON without repeating its content', () => {
    let error: unknown;
    try {
      new FrameDecoder().push(frameOf(Buffer.from('private text {', 'utf8')));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(FramingError);
    expect((error as Error).message).not.toContain('private');
  });
});
