import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { COMPANION_PROTOCOL_VERSION, type FromCompanion, IRIS_EXTENSION_ID } from '@iris/protocol';
import { isIrisCaller, runHost, type Sensing } from '../../companion/src/host';
import { encodeMessage, FrameDecoder, MAX_MESSAGE_BYTES } from '../../companion/src/messaging/framing';

const IRIS = `chrome-extension://${IRIS_EXTENSION_ID}/`;
const RUNNING = { type: 'status', state: 'running' };
const STOPPED = { type: 'status', state: 'stopped' };

/** Stands in for Presage: says "running" on start and records what the host asked of it. */
class FakeSensing implements Sensing {
  readonly calls: string[] = [];

  start(send: (message: FromCompanion) => void): void {
    this.calls.push('start');
    send({ type: 'status', state: 'running' });
  }

  async stop(): Promise<void> {
    this.calls.push('stop');
  }
}

/** Starts the host on in-memory streams, the way Chrome would on stdin and stdout. */
function startHost(callerOrigin: string | undefined = IRIS) {
  const input = new PassThrough();
  const output = new PassThrough();
  const sensing = new FakeSensing();
  const sent: unknown[] = [];
  const logs: string[] = [];
  const decoder = new FrameDecoder();
  output.on('data', (chunk: Buffer) => sent.push(...decoder.push(chunk)));
  const exit = runHost({ input, output, callerOrigin, sensing, log: (line) => logs.push(line) });
  return { input, output, sensing, sent, logs, exit };
}

/** Lets stream events run before checking what the host sent. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('isIrisCaller', () => {
  it('accepts only the Iris extension origin', () => {
    expect(isIrisCaller(IRIS)).toBe(true);
    expect(isIrisCaller(`chrome-extension://${'a'.repeat(32)}/`)).toBe(false);
    expect(isIrisCaller(`chrome-extension://${IRIS_EXTENSION_ID}`)).toBe(false);
    expect(isIrisCaller('https://example.com/')).toBe(false);
    expect(isIrisCaller(undefined)).toBe(false);
  });
});

describe('runHost', () => {
  it('refuses any caller but Iris without sending anything or starting sensing', async () => {
    const host = startHost(`chrome-extension://${'a'.repeat(32)}/`);
    expect(await host.exit).toBe(1);
    await settle();
    expect(host.sent).toEqual([]);
    expect(host.sensing.calls).toEqual([]);
    expect(host.logs.join('\n')).toContain('refusing caller');
  });

  it('says hello with the protocol version first', async () => {
    const host = startHost();
    await settle();
    expect(host.sent).toEqual([{ type: 'hello', version: COMPANION_PROTOCOL_VERSION }]);
  });

  it('starts sensing on start and passes its messages on', async () => {
    const host = startHost();
    host.input.write(encodeMessage({ type: 'start' }));
    await settle();
    expect(host.sensing.calls).toEqual(['start']);
    expect(host.sent.slice(1)).toEqual([RUNNING]);
  });

  it('stops sensing on stop, then reports "stopped"', async () => {
    const host = startHost();
    host.input.write(encodeMessage({ type: 'start' }));
    host.input.write(encodeMessage({ type: 'stop' }));
    await settle();
    expect(host.sensing.calls).toEqual(['start', 'stop']);
    expect(host.sent.slice(1)).toEqual([RUNNING, STOPPED]);
  });

  it('drops a message that breaks the protocol without logging its content, and keeps going', async () => {
    const host = startHost();
    host.input.write(encodeMessage({ type: 'start', note: 'private-note' }));
    host.input.write(encodeMessage({ type: 'start' }));
    await settle();
    expect(host.sensing.calls).toEqual(['start']);
    expect(host.logs.join('\n')).toContain('dropped');
    expect(host.logs.join('\n')).not.toContain('private-note');
  });

  it('stops sensing, then exits with 0, when Chrome closes the connection', async () => {
    const host = startHost();
    host.input.write(encodeMessage({ type: 'start' }));
    await settle();
    host.input.end();
    expect(await host.exit).toBe(0);
    expect(host.sensing.calls).toEqual(['start', 'stop']);
  });

  it('exits with 1 instead of crashing when Chrome closes its end of the output', async () => {
    const host = startHost();
    host.output.destroy(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    expect(await host.exit).toBe(1);
    expect(host.sensing.calls).toEqual(['stop']);
    expect(host.logs.join('\n')).toContain('output closed');
  });

  it('exits with 1 when the input is corrupt', async () => {
    const host = startHost();
    const header = Buffer.alloc(4);
    header.writeUInt32LE(MAX_MESSAGE_BYTES + 1, 0);
    host.input.write(header);
    expect(await host.exit).toBe(1);
    expect(host.sensing.calls).toEqual(['stop']);
    expect(host.logs.join('\n')).toContain('corrupt');
  });
});
