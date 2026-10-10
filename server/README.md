# Iris server: local Gemini setup

This local scaffold checks the Worker runtime, Gemini connectivity, and text-based
page target selection. It does not implement screenshot understanding or
ElevenLabs integration yet.

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

This sends one fixed text prompt to Gemini, using your project's API quota.
Success prints `Gemini connection succeeded` and whether the expected reply
matched. No page content, screenshots, or sensor data are sent. The check does
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

## Test target selection through HTTP

Use Node 22 or newer and the existing `.dev.vars` configuration. Keep this
milestone local; the endpoint has no session authentication or rate limiting.
Do not deploy it or expose the development server to the network.

Terminal 1, from the repository root:

```sh
cd server
npm run dev
```

Terminal 2:

```sh
curl --fail-with-body \
  http://127.0.0.1:8787/gemini/find-target \
  -H 'Content-Type: application/json' \
  --data '{"request":"Find the history link","targets":[{"id":1,"label":"History","role":"link"},{"id":2,"label":"Contact","role":"button"}]}'
```

Expected response: `{"targetId":1}`. Change the request to `Find the pricing
link` to check a missing target, or `Find history or contact` to check ambiguity;
both should return `{"targetId":null}`. These are deliberate real Gemini calls
using synthetic page labels, and each uses your project's API quota. Model
accuracy is verified manually, separately from the automated tests.

The Worker sends the request and target labels to Gemini and validates its JSON
selection. It does not click anything, accept screenshots, or store page data.
It returns only a supplied ID or null, and logs no keys, labels, or model output.
The existing `check:gemini` script remains a separate direct connectivity check.

Input requires a nonempty request (up to 500 characters), 1 to 100 targets with
unique positive integer IDs, nonempty labels (up to 200 characters), and roles
of `link` or `button`. The request body limit is 64 KiB.

Errors return JSON with an `error` message: 400 for invalid input, 405 for a
wrong method, 413 for oversized bodies, 415 for non-JSON input, 502 for upstream
failures or invalid model output, 503 for configuration/quota/unavailability,
and 504 for the 30-second Gemini timeout. Requests are not automatically retried.

Run deterministic tests and build checks from `server/`:

```sh
npm test
npm run typecheck
npx wrangler deploy --dry-run
```

Tests simulate Gemini responses and never use your API key or paid quota.
