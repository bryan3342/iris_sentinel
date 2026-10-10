import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPresageKey, type RunFile } from '../../companion/src/secrets/keychain';

// Obviously fake: these tests never touch the real Keychain.
const FAKE_KEY = 'fake-presage-key-for-tests';

const printing = (stdout: string): RunFile => async () => ({ stdout });
const failing = (error: Error): RunFile => async () => {
  throw error;
};

afterEach(() => vi.restoreAllMocks());

describe('readPresageKey', () => {
  it('asks /usr/bin/security for the iris-presage item directly, with no shell', async () => {
    const run = vi.fn<RunFile>(printing(`${FAKE_KEY}\n`));
    await readPresageKey(run);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith('/usr/bin/security', ['find-generic-password', '-s', 'iris-presage', '-a', 'iris', '-w']);
  });

  it('returns the key without its trailing newline', async () => {
    expect(await readPresageKey(printing(`${FAKE_KEY}\n`))).toBe(FAKE_KEY);
  });

  it('returns null when the item is missing or the tool fails', async () => {
    expect(await readPresageKey(failing(new Error('The specified item could not be found in the keychain.')))).toBeNull();
  });

  it('returns null for an empty key', async () => {
    expect(await readPresageKey(printing('  \n'))).toBeNull();
  });

  it('never prints the key, even when the tool fails after printing it', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const error = Object.assign(new Error('Command timed out'), { stdout: FAKE_KEY });
    await expect(readPresageKey(failing(error))).resolves.toBeNull();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});
