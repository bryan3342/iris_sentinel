import { describe, expect, it } from 'vitest';
import { InMemorySessionStore } from '@iris/core';
import type { FatigueMinute } from '@iris/protocol';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const PROFILE = '00000000-0000-4000-8000-000000000001';
const OTHER_PROFILE = '00000000-0000-4000-8000-000000000002';
const SESSION = '00000000-0000-4000-8000-0000000000aa';

const minute = (iso: string, fatigueScore: number, overrides: Partial<FatigueMinute> = {}): FatigueMinute => ({
  minute: iso,
  profileId: PROFILE,
  sessionId: SESSION,
  fatigueScore,
  fatigueLevel: 'tiring',
  clicks: 2,
  backAfterClick: 1,
  ...overrides,
});

const storeAtNow = () => new InMemorySessionStore(() => NOW);

describe('InMemorySessionStore', () => {
  it('skips a minute already saved for the same session, so retries are safe', async () => {
    const store = storeAtNow();
    await store.appendMinutes([minute('2026-10-09T18:59:00Z', 40)]);
    await store.appendMinutes([minute('2026-10-09T18:59:00.000Z', 90)]);
    const [day] = await store.dailyTrends(PROFILE, 14);
    expect(day).toMatchObject({ activeMinutes: 1, avgScore: 40 });
  });

  it('keeps the same minute from two different sessions', async () => {
    const store = storeAtNow();
    await store.appendMinutes([
      minute('2026-10-09T18:59:00Z', 40),
      minute('2026-10-09T18:59:00Z', 60, { sessionId: '00000000-0000-4000-8000-0000000000bb' }),
    ]);
    const [day] = await store.dailyTrends(PROFILE, 14);
    expect(day?.activeMinutes).toBe(2);
  });

  it('totals each UTC day like fatigue_daily, oldest first', async () => {
    const store = storeAtNow();
    await store.appendMinutes([
      minute('2026-10-09T00:00:00Z', 60, { clicks: 3, backAfterClick: 2 }),
      minute('2026-10-08T23:59:00Z', 50),
      minute('2026-10-08T23:58:00Z', 30, { clicks: 5, backAfterClick: 0 }),
    ]);
    expect(await store.dailyTrends(PROFILE, 14)).toEqual([
      { day: '2026-10-08', avgScore: 40, peakScore: 50, activeMinutes: 2, clicks: 7, backAfterClick: 1 },
      { day: '2026-10-09', avgScore: 60, peakScore: 60, activeMinutes: 1, clicks: 3, backAfterClick: 2 },
    ]);
  });

  it('returns only the requested profile', async () => {
    const store = storeAtNow();
    await store.appendMinutes([
      minute('2026-10-09T18:00:00Z', 40),
      minute('2026-10-09T18:01:00Z', 90, { profileId: OTHER_PROFILE, sessionId: '00000000-0000-4000-8000-0000000000cc' }),
    ]);
    const days = await store.dailyTrends(PROFILE, 14);
    expect(days.map((d) => d.avgScore)).toEqual([40]);
    expect(await store.dailyTrends('00000000-0000-4000-8000-00000000ffff', 14)).toEqual([]);
  });

  it('covers from `days` days before today through today', async () => {
    const store = storeAtNow();
    await store.appendMinutes([
      minute('2026-09-25T23:59:00Z', 10), // 15 days before today: outside
      minute('2026-09-26T00:00:00Z', 20), // 14 days before today: inside
      minute('2026-10-10T11:00:00Z', 30), // today: inside
    ]);
    const days = await store.dailyTrends(PROFILE, 14);
    expect(days.map((d) => d.day)).toEqual(['2026-09-26', '2026-10-10']);
  });
});
