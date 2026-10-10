import type { DailyTrend, FatigueMinute, SessionStore } from '@iris/protocol';

/**
 * SessionStore held in memory: the simulated store for tests and for running
 * without Tiger Data, and the reference for the Worker-backed store. It follows
 * the same rules as `server/db/`: one row per session per minute (a retry is
 * skipped) and days grouped in UTC with the same totals as `fatigue_daily`.
 */

const DAY_MS = 86_400_000;
const startOfUtcDay = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;
const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

export class InMemorySessionStore implements SessionStore {
  private readonly minutes = new Map<string, FatigueMinute>();
  private readonly now: () => number;

  /** `now` returns epoch milliseconds; tests pass a fixed clock to control which days count. */
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async appendMinutes(minutes: FatigueMinute[]): Promise<void> {
    for (const m of minutes) {
      // Keyed by the instant, not the text, so "18:59:00Z" and "18:59:00.000Z" match.
      const key = `${m.sessionId}|${Date.parse(m.minute)}`;
      if (!this.minutes.has(key)) this.minutes.set(key, m);
    }
  }

  async dailyTrends(profileId: string, days: number): Promise<DailyTrend[]> {
    const from = startOfUtcDay(this.now()) - days * DAY_MS;
    const byDay = new Map<number, FatigueMinute[]>();
    for (const m of this.minutes.values()) {
      const day = startOfUtcDay(Date.parse(m.minute));
      if (m.profileId !== profileId || day < from) continue;
      byDay.set(day, [...(byDay.get(day) ?? []), m]);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a - b)
      .map(([day, ms]) => ({
        day: new Date(day).toISOString().slice(0, 10),
        avgScore: sum(ms.map((m) => m.fatigueScore)) / ms.length,
        peakScore: Math.max(...ms.map((m) => m.fatigueScore)),
        activeMinutes: ms.length,
        clicks: sum(ms.map((m) => m.clicks)),
        backAfterClick: sum(ms.map((m) => m.backAfterClick)),
      }));
  }
}
