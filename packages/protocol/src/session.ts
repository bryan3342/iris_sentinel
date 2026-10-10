/**
 * Fatigue history contract: one-minute fatigue summaries kept over days for the
 * caregiver trends view. Mirrors the `fatigue_minutes` table and the
 * `fatigue_daily` summary in `server/db/`. Opt-in only. Implemented in memory
 * (tests and running without Tiger Data) and by the Worker in front of Tiger
 * Data; callers never see SQL or vendor types. Only these summary fields are
 * stored: never heart, breathing or blink data, names or page URLs.
 */

/** Fatigue bands, mildest first, one per Iris response (see docs/architecture.md 3.1). */
export const FATIGUE_LEVELS = ['fresh', 'tiring', 'fatigued', 'strained'] as const;
export type FatigueLevel = (typeof FATIGUE_LEVELS)[number];

/** One user's fatigue over one minute. */
export interface FatigueMinute {
  /** Start of the minute, ISO 8601 in UTC, for example "2026-10-09T18:59:00Z". */
  minute: string;
  /** Random ID made on the laptop at opt-in. Resettable and never tied to a name. */
  profileId: string;
  /** Random ID for one browsing session. */
  sessionId: string;
  /** 0 (rested) to 100 (most tired). */
  fatigueScore: number;
  fatigueLevel: FatigueLevel;
  /** Clicks made during the minute. */
  clicks: number;
  /** Clicks during the minute that the user undid with "go back". */
  backAfterClick: number;
}

/** One profile's fatigue over one UTC day, as the trends view reads it. */
export interface DailyTrend {
  /** UTC date, for example "2026-10-09". */
  day: string;
  avgScore: number;
  peakScore: number;
  /** Minutes with a saved summary that day. */
  activeMinutes: number;
  clicks: number;
  backAfterClick: number;
}

export interface SessionStore {
  /** Saves minutes. A minute already saved for the same session is skipped, so retries are safe. */
  appendMinutes(minutes: FatigueMinute[]): Promise<void>;
  /** One profile's days from `days` days before today through today (UTC), oldest first. */
  dailyTrends(profileId: string, days: number): Promise<DailyTrend[]>;
}
