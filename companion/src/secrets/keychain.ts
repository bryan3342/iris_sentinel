// Reads the Presage API key from the macOS Keychain. A developer stores it once:
//
//   security add-generic-password -U -s iris-presage -a iris -w
//
// With -w last the tool prompts for the key, so it never lands in shell history.
// This is the one secret Iris keeps on the laptop. It lives in the Keychain and
// in memory only: never in files, logs, command-line arguments or environment.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Runs a program directly, with no shell, and returns what it printed. */
export type RunFile = (file: string, args: readonly string[]) => Promise<{ stdout: string }>;

export const KEYCHAIN_SERVICE = 'iris-presage';
export const KEYCHAIN_ACCOUNT = 'iris';

const SECURITY = '/usr/bin/security';
const execFileAsync = promisify(execFile);

/** The real runner: an absolute path, no shell, and a timeout so a stuck tool cannot hang startup. */
const runFile: RunFile = (file, args) => execFileAsync(file, args, { encoding: 'utf8', timeout: 10_000 });

/**
 * Returns the Presage key, or null when it is missing or unreadable (no item,
 * access denied, or not on macOS). Never throws and never says why: a failed
 * run's error carries the tool's output, which could include the key.
 */
export async function readPresageKey(run: RunFile = runFile): Promise<string | null> {
  try {
    const { stdout } = await run(SECURITY, ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w']);
    const key = stdout.trim();
    return key === '' ? null : key;
  } catch {
    return null;
  }
}
