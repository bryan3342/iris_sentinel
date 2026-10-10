import { runHost } from './host';

// Entry point Chrome launches. Stdout carries native messaging frames, so
// nothing else may write to it: any stray console output goes to stderr.
// SIGTERM keeps Node's default (exit at once), since there is nothing to clean
// up until the Presage session is wired in.

const toStderr = (...args: unknown[]) => console.error(...args);
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;

process.exitCode = await runHost({
  input: process.stdin,
  output: process.stdout,
  callerOrigin: process.argv[2],
  log: (line) => process.stderr.write(`iris-companion: ${line}\n`),
});
// Stop reading so the process can exit once pending output has flushed.
process.stdin.destroy();
