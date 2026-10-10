import { runHost } from './host';
import { PresageSensing } from './presage/sensing';
import { PresageSession } from './presage/session';
import { readPresageKey } from './secrets/keychain';

// Entry point Chrome launches. Stdout carries native messaging frames, so
// nothing else may write to it: any stray console output goes to stderr.

const toStderr = (...args: unknown[]) => console.error(...args);
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;

const sensing = new PresageSensing({
  readKey: readPresageKey,
  createSession: (apiKey, events) => new PresageSession(apiKey, events),
});

// If Chrome stops the companion directly, release the camera before exiting.
process.on('SIGTERM', () => void sensing.stop().finally(() => process.exit(0)));

process.exitCode = await runHost({
  input: process.stdin,
  output: process.stdout,
  callerOrigin: process.argv[2],
  sensing,
  log: (line) => process.stderr.write(`iris-companion: ${line}\n`),
});
// Stop reading so the process can exit once pending output has flushed.
process.stdin.destroy();
