import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** Run deliberately by the trusted operator, not by tests or extension clients. */
export function provisionDemoSession(now = Date.now()) {
  const sessionId = randomUUID(), sessionToken = randomBytes(32).toString('base64url');
  const expiresAt = now + 15 * 60_000;
  return { sessionToken, expiresAt, serverBinding: { [sessionId]: {
    tokenHash: createHash('sha256').update(sessionToken).digest('hex'), expiresAt,
  } } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Intentional operator output: keep the token private; only the hash belongs server-side.
  process.stdout.write(JSON.stringify(provisionDemoSession(), null, 2) + '\n');
}
