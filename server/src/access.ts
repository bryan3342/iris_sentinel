import { object, text, token } from '../../packages/protocol/src/page-understanding';
import { HttpError } from './http';

export interface AccessEnv {
  /** Operator-provisioned session IDs -> hashes and fixed expiries. Never raw tokens. */
  DEMO_SESSIONS?: string;
}
interface ProvisionedSession { tokenHash: string; expiresAt: number }
interface Usage { expiresAt: number; count: number; recent: number[]; lease?: { id: string; expiresAt: number } }
export interface Lease { sessionId: string; leaseId: string }
export async function tokenHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
function sessions(env: AccessEnv, now: number): Record<string, ProvisionedSession> {
  let values: unknown;
  try { values = JSON.parse(env.DEMO_SESSIONS || '{}'); } catch { throw new HttpError(503, 'NOT_CONFIGURED'); }
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 20) throw new HttpError(503, 'NOT_CONFIGURED');
  const result: Record<string, ProvisionedSession> = {};
  try {
    for (const [sessionId, value] of Object.entries(values)) {
      token(sessionId); const s = object(value, ['tokenHash', 'expiresAt']);
      const hash = text(s.tokenHash, 64);
      if (!/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(s.expiresAt) || (s.expiresAt as number) > now + 900_000) throw new Error();
      result[sessionId] = { tokenHash: hash, expiresAt: s.expiresAt as number };
    }
  } catch { throw new HttpError(503, 'NOT_CONFIGURED'); }
  return result;
}
/** Private-demo, per-Worker-instance limits only. No database or persistence.
 * Other instances/cold starts have separate counters; this is not global enforcement.
 */
export class DemoAccess {
  private usage = new Map<string, Usage>();
  constructor(private now = () => Date.now()) {}
  async admit(env: AccessEnv, bearer: string): Promise<Lease> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(bearer)) throw new HttpError(401, 'UNAUTHENTICATED');
    const digest = await tokenHash(bearer);
    const now = this.now(), configured = sessions(env, now);
    for (const [key, state] of this.usage) if (state.expiresAt <= now || !Object.values(configured).some(s => s.tokenHash === key)) this.usage.delete(key);
    const match = Object.entries(configured).find(([, s]) => s.tokenHash === digest && s.expiresAt > now);
    if (!match) throw new HttpError(401, 'UNAUTHENTICATED');
    const [sessionId, session] = match;
    const state = this.usage.get(digest) ?? { expiresAt: session.expiresAt, count: 0, recent: [] };
    // No await between checking and reserving: local concurrent calls cannot overlap.
    if (state.lease && state.lease.expiresAt > now) throw new HttpError(409, 'REQUEST_IN_FLIGHT', 45);
    state.recent = state.recent.filter(t => t > now - 60_000);
    if (state.count >= 10 || state.recent.length >= 2) throw new HttpError(429, 'RATE_LIMITED', 60);
    state.count++; state.recent.push(now);
    state.lease = { id: crypto.randomUUID(), expiresAt: now + 45_000 };
    this.usage.set(digest, state);
    return { sessionId, leaseId: state.lease.id };
  }
  release(env: AccessEnv, lease: Lease): void {
    const session = sessions(env, this.now())[lease.sessionId];
    if (!session) return;
    const state = this.usage.get(session.tokenHash);
    if (state?.lease?.id === lease.leaseId) delete state.lease;
  }
}
