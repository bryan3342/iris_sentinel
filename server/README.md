# Iris server: v0.1 private-demo MVP

The Worker implements authenticated, bounded viewport screenshot understanding,
target recommendations, summaries and local-image-crop descriptions. It has no
browser actions. A separate ElevenLabs session endpoint is described below. Gemini only recommends or explains;
every future click requires Iris confirmation in a separate milestone.

The feature is disabled by default. See the
[protocol](../docs/page-understanding-protocol.md) and
[readiness record](../docs/page-understanding-readiness.md). No deployment or paid
call is needed to test it.

Use Node.js 22 or newer (the repository's CI uses Node 22).

From the repository root:

```sh
cd server
npm ci
cp .dev.vars.example .dev.vars
```

Open `.dev.vars` in your editor and replace `replace_with_your_key` with your
Google AI Studio API key. Do not paste the key into chat or commit it.
This file is ignored by Git. Do not put secrets in `wrangler.jsonc`.

```sh
npm run check:gemini
```

This sends two small requests to Gemini, using your project's API quota: one
fixed text prompt, then a one-pixel image through the Worker's own Gemini
adapter, in the same format page understanding uses. Success prints
`Gemini connection succeeded`, whether the expected reply matched, and
`Page understanding request accepted: true`. No page content, screenshots, or
sensor data are sent. The check does
not print the key, upstream error bodies, or generated text.

The initial smoke check was run by the repository contributor and reported:

```text
Gemini connection succeeded (gemini-3.8-flash).
Expected reply matched: true.
```

The default model is `gemini-3.8-flash`; change `GEMINI_MODEL` in `.dev.vars` if
your project uses another supported model. HTTP 403 indicates access or key
permissions, 404 suggests a model availability problem, and 429 indicates quota
or rate limits. Check Google AI Studio for project details.

To check the Worker separately:

```sh
npm run dev
```

In another terminal:

```sh
curl http://127.0.0.1:8787/health
```

Expected response: `{"status":"ok","service":"iris-server"}`.
The health endpoint does not call Gemini or expose secrets. The Gemini smoke
check runs directly from your local development script, not through the Worker.
No deployment is needed for these checks. A future deployed integration must
use Worker secrets, authenticated requests, and session rate limits.

References:
- [Gemini API reference](https://ai.google.dev/api)
- [Cloudflare local secrets](https://developers.cloudflare.com/workers/local-development/environment-variables/)

## Authenticated viewport operations without spending credits

For the simplest manual-first setup, follow the
[manual test guide](../docs/page-understanding-manual-test.md). Its dedicated
launcher serves the fixture and synthetic Worker together, provisions a temporary
token, never reads `.dev.vars`, and blocks every external Worker request. Use
`npm run manual:demo -- <extension-ID>` from `server/` with Node 22.
The longer steps below configure a regular Wrangler development session instead.

1. Build/load the unpacked extension with Node 22 (`npm ci`, `npm run build`
   at the repository root). Open Iris on a normal tab to grant `activeTab`.
2. A trusted operator runs `node server/scripts/provision-demo-session.mjs`.
   This deliberately prints a private participant token, expiry and `serverBinding`.
   Do not run it in captured CI/logs or paste its output into chat. Add only the
   `serverBinding` JSON to `DEMO_SESSIONS` in ignored `.dev.vars`; merge entries
   for multiple participants. Hand each token privately to its verified participant.
3. Set `EXTENSION_ORIGIN=chrome-extension://<exact 32-letter ID>` in `.dev.vars`.
   Set `ENABLE_PAGE_UNDERSTANDING=true`, `PAGE_UNDERSTANDING_PROVIDER=synthetic`,
   and leave `PAGE_CONTENT_APPROVED=false`. The synthetic provider is localhost-only
   and produces clearly marked fixed responses, not accuracy evaluations.
4. Run `npm run dev` in `server/`. Enter `http://127.0.0.1:8787` in the panel,
   use **Allow gateway access**, then enter the token and use **Use demo session**.
   The token input is cleared; it remains only in background memory. Use the
   explicit screenshot buttons and list visible image numbers before describing.
5. Verify sensitive fields, cancellation and changed-page rejection on the
   [synthetic fixture](../tests/fixtures/page-understanding.html). No screenshot,
   page text or credentials are persisted. No database is required.

Sessions expire on the server within 15 minutes of operator provisioning.
Extension background restarts require token re-entry; server revocation removes
its `DEMO_SESSIONS` entry. No signing keys, IndexedDB, Durable Objects, KV or
migrations are used. Participant tokens are runtime credentials, never embedded
extension secrets or a reusable shared demo password.

Within one Worker instance, limits are 2 attempts/minute/session, 10/session and
one in-flight/session. Failed admitted attempts count and re-entering a token
preserves counters within that instance. Cold starts reset counters; separate
Worker instances have independent limits. These are private-demo guardrails,
not distributed concurrency enforcement or an exact spending cap. New tokens
are manually provisioned, never automatically renewed. Coordinated enforcement
and the team's database/auth integration remain future work.

If deployment is separately approved later, use Worker secrets for
`GEMINI_API_KEY` and operator-controlled configuration for session hashes/expiry;
never commit credentials. The current change leaves deployment disabled and
has no account/database setup.

## Real content and billing gate

Before changing provider to Gemini and setting `PAGE_CONTENT_APPROVED=true`,
follow the [live Gemini runbook](../docs/gemini-live-runbook.md) and complete
the readiness record: verify applicable Google data terms, logging/data
sharing, retention, model availability, credits, auto-reload and paid fallback.
The reported $60 and disabled auto-reload are unverified. Iris retains screenshot
bytes only transiently; that is not a promise of zero provider retention.
Masking detectable form fields cannot remove every private detail. Users explicitly
request each transmission; no automatic screenshot/background upload exists.

All responses use `Cache-Control: no-store`. Owned request/result objects reject
unknown fields. Images are bounded canonical PNGs with validated structure/CRC,
dimensions and inflation. Upstream response parsing is bounded independently
of Gemini's schema. Deadlines cover ingestion, upstream body reads and complete
requests. Quota/configuration failures fail closed. Disable the feature
with `ENABLE_PAGE_UNDERSTANDING=false`. Conservative limits are not an exact
global spending ceiling, and aborting a request may not stop provider billing.

The committed Worker observability setting is off. Do not enable request/response
payload logging, traces, debugger captures, queues or caches for browsing content.
Do not paste real requests into dashboards or retain screenshot fixtures from users.

## Deterministic verification

Use Node 22 or newer. From the root run `npm test`, `npm run typecheck`, and
`npm run build`; separately run the server commands above. Server tests include
direct adapter/route tests and an actual database-free local Worker test
using synthetic images with **all external requests blocked**. This runtime test
opens a loopback listener. It does not read `.dev.vars` or call Gemini.
The dry-run build compiles only; do not remove `--dry-run` without separate approval.

## ElevenLabs session endpoint

`POST /v0.1/agent-token` takes `{}` as JSON and the existing demo bearer token.
Enable `ENABLE_VOICE_AGENT=true`, configure `ELEVENLABS_AGENT_ID`, and put
`ELEVENLABS_API_KEY` in ignored `.dev.vars` locally or a Worker secret in deployment.
The agent must require authentication. Use the same provisioned `DEMO_SESSIONS`
and exact `EXTENSION_ORIGIN` as the private page-understanding demo.
Success returns `{ "signedUrl": "wss://..." }` with `Cache-Control: no-store`.
The URL is a credential for one conversation; do not log, save or share it.
Minting shares the per-instance demo budget (2/minute, 10/session); this does not
limit the resulting conversation's duration or spend. No automatic retries occur.
`npm test` exercises mocked ElevenLabs responses without keys or paid API calls.
This milestone supplies credentials only; the extension voice UI follows later.
