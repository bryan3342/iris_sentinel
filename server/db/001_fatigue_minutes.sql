-- Raw fatigue history: one row per user per minute.
--
-- Privacy (docs/architecture.md 3.3): only these summary columns are stored.
-- Heart, breathing and blink data, video, names and page URLs never reach this table.

CREATE TABLE fatigue_minutes (
  minute           timestamptz NOT NULL,  -- start of the minute, UTC
  profile_id       uuid        NOT NULL,  -- random, made on the laptop at opt-in, resettable
  session_id       uuid        NOT NULL,  -- random per browsing session
  fatigue_score    real        NOT NULL CHECK (fatigue_score BETWEEN 0 AND 100),
  fatigue_level    text        NOT NULL
                   CHECK (fatigue_level IN ('fresh', 'tiring', 'fatigued', 'strained')),
  clicks           smallint    NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  back_after_click smallint    NOT NULL DEFAULT 0 CHECK (back_after_click >= 0),

  -- One row per session per minute. A retried upload hits this key and is
  -- skipped (INSERT ... ON CONFLICT DO NOTHING) instead of double counting.
  PRIMARY KEY (session_id, minute)
) WITH (
  -- Hypertable: TimescaleDB stores the table as weekly time slices ("chunks").
  -- It is still queried like a normal table.
  tsdb.hypertable,
  tsdb.partition_column = 'minute',
  tsdb.chunk_interval   = '7 days',
  -- Older chunks are compressed column by column. Grouping by profile keeps
  -- one person's minutes together, which is how trends are read.
  tsdb.segmentby        = 'profile_id',
  tsdb.orderby          = 'minute DESC'
);

-- Delete raw minutes after 90 days. A TimescaleDB background job drops whole
-- chunks once every row in them is older than that.
SELECT add_retention_policy('fatigue_minutes', drop_after => INTERVAL '90 days');
