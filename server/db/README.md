# Iris server: Tiger Data schema

SQL for the optional fatigue history behind `SessionStore` (see
`docs/architecture.md`, sections 2 and 3.3). Tiger Data is managed Postgres with
the TimescaleDB extension for time-series data.

| File | What it creates |
| :--- | :--- |
| `001_fatigue_minutes.sql` | `fatigue_minutes`: one row per user per minute, deleted after 90 days |
| `seed_dev.sql` | 14 days of fake minutes for one fake profile (dev and demos only) |

**Stored per minute:** fatigue score (0 to 100), fatigue level, click count and
back-after-click count, keyed by a random profile ID and session ID.
**Never stored:** video, face landmarks, heart, breathing or blink data, names
and page URLs.

## Set up a dev database

You need the [Tiger CLI](https://www.tigerdata.com/docs) and a Tiger Cloud
service tagged `DEV`. `psql` is not required.

```sh
tiger auth login
tiger service create --name iris-sessions-dev --cpu shared
tiger db ping
```

`service create` makes the new service your default, so the commands below
need no service ID. Run them from the repository root, in section order.

## 1. Minute table

```sh
tiger db query --file server/db/001_fatigue_minutes.sql
```

| Check | Command | Expected |
| :--- | :--- | :--- |
| TimescaleDB is on | `tiger db query -c "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb';"` | A version number |
| Hypertable exists | `tiger db query -c "SELECT hypertable_name FROM timescaledb_information.hypertables;"` | `fatigue_minutes` |
| Retention job exists | `tiger db query -c "SELECT proc_name FROM timescaledb_information.jobs WHERE hypertable_name = 'fatigue_minutes';"` | Includes `policy_retention` |

Retried uploads are skipped. Run this twice:

```sh
tiger db query -c "
INSERT INTO fatigue_minutes (minute, profile_id, session_id, fatigue_score, fatigue_level)
VALUES (date_trunc('day', now()), '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-0000000000aa', 42, 'tiring')
ON CONFLICT (session_id, minute) DO NOTHING;"
tiger db query -c "SELECT count(*) FROM fatigue_minutes WHERE session_id = '00000000-0000-4000-8000-0000000000aa';"
```

Expected: `1` both times.

Out-of-range values are rejected. Change `42` to `150` and run the insert
again. Expected: an error naming `fatigue_minutes_fatigue_score_check`.

Remove the test row:

```sh
tiger db query -c "DELETE FROM fatigue_minutes WHERE session_id = '00000000-0000-4000-8000-0000000000aa';"
```

## 2. Fake data (dev only)

One fake profile with one 60-minute session per day for the last 14 days. The
recent week scores higher than the week before, so trends are easy to see.
Each run clears the fake profile first, so re-running on a later day moves the
14 days forward instead of adding a second copy. Other profiles are untouched.

```sh
tiger db query --file server/db/seed_dev.sql
```

| Check | Command | Expected |
| :--- | :--- | :--- |
| Seed loaded | `tiger db query -c "SELECT count(*) FROM fatigue_minutes;"` | `840` (14 days x 60 minutes) |
| Re-run is safe | Run the seed again (any day), then the count | Still `840` |
| Time slices | `tiger db query -c "SELECT show_chunks('fatigue_minutes');"` | 2 or 3 chunks (one per week) |

## Start over (dev only)

```sh
tiger db query -c "DROP TABLE IF EXISTS fatigue_minutes;"
```

Then run the sections again from 1.

## Connecting the Worker

The `/sessions` routes (a later PR) will read the connection string from the
Worker secret `TIGER_DATABASE_URL`: in `server/.dev.vars` locally (ignored by
Git) and `wrangler secret put` when deployed. The string contains the database
password. Do not paste it into chat, issues or code.
