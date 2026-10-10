-- Fake data for development and demos. Run only against the DEV service.
--
-- One fake profile with one 60-minute session per day for the last 14 days.
-- The older week scores lower than the recent week, so a week-over-week chart
-- shows a clear rise. Values are deterministic (no random()), so every run
-- produces the same rows, and re-running is a no-op thanks to ON CONFLICT.

INSERT INTO fatigue_minutes
  (minute, profile_id, session_id, fatigue_score, fatigue_level, clicks, back_after_click)
SELECT
  m.minute,
  '00000000-0000-4000-8000-000000000001'::uuid,       -- the fake profile
  md5('iris-seed-session-' || d.day_offset)::uuid,    -- one stable session per day
  s.score,
  CASE WHEN s.score < 35 THEN 'fresh'
       WHEN s.score < 55 THEN 'tiring'
       WHEN s.score < 75 THEN 'fatigued'
       ELSE 'strained' END,
  greatest(0, 8 - round(s.score / 15)),               -- fewer clicks when tired
  round(s.score / 30)                                  -- more "go back" when tired
FROM generate_series(1, 14) AS d(day_offset)           -- 1 = yesterday, 14 = two weeks ago
CROSS JOIN generate_series(0, 59) AS i(minute_index)   -- minutes 0..59 of the session
CROSS JOIN LATERAL (
  -- Each session runs 18:00 to 19:00 UTC.
  SELECT date_trunc('day', now(), 'UTC') - make_interval(days => d.day_offset)
         + INTERVAL '18 hours' + make_interval(mins => i.minute_index) AS minute
) AS m
CROSS JOIN LATERAL (
  SELECT least(100, greatest(0,
           CASE WHEN d.day_offset > 7 THEN 25 ELSE 45 END  -- older week starts lower
           + i.minute_index * 0.5                         -- fatigue builds over the hour
           + 5 * sin(i.minute_index / 4.0)                -- small, repeatable wobble
         ))::real AS score
) AS s
ON CONFLICT (session_id, minute) DO NOTHING;
