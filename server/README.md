# Iris server: local Gemini setup

This first scaffold checks the local Worker runtime and a Gemini API connection.
It does not implement page understanding or ElevenLabs integration yet.

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
