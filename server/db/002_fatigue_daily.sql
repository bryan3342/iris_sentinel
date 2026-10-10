-- Daily summary per profile, read by the caregiver trends view.
--
-- A continuous aggregate is a saved GROUP BY that TimescaleDB keeps up to date
-- in the background (see 003), so a trends query reads 14 rows instead of
-- thousands of minutes.
--
-- materialized_only = false turns on real-time aggregation: minutes newer than
-- the last background refresh are added on the fly, so today's data shows up
-- right away.
--
-- WITH NO DATA creates the view empty. 003 and the manual refresh in
-- README.md fill it.

CREATE MATERIALIZED VIEW fatigue_daily
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  profile_id,
  time_bucket(INTERVAL '1 day', minute) AS day,  -- UTC days
  avg(fatigue_score)                    AS avg_score,
  max(fatigue_score)                    AS peak_score,
  count(*)                              AS active_minutes,
  sum(clicks)                           AS clicks,
  sum(back_after_click)                 AS back_after_click
FROM fatigue_minutes
GROUP BY profile_id, day
WITH NO DATA;
