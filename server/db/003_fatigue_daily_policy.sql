-- Refresh fatigue_daily every hour, recomputing the last 3 days.
--
-- start_offset: how far back each refresh looks (late uploads land within this).
-- end_offset:   skip the most recent hour, which is still filling up. Real-time
--               aggregation (002) covers it instead.
--
-- Days older than start_offset are never recomputed by this policy, so data
-- loaded in bulk (like seed_dev.sql) needs a one-time manual refresh.
-- See README.md.

SELECT add_continuous_aggregate_policy('fatigue_daily',
  start_offset      => INTERVAL '3 days',
  end_offset        => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');
