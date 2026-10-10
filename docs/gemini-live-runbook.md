# Runbook: first live Gemini connection

This runbook connects Iris's page understanding to the real Gemini API on one
computer, makes one deliberate test request, and turns it off again. A person
runs every step by hand; nothing here is automated. Allow about 45 minutes.

Everything runs locally. Nothing is deployed. Until this runbook is complete,
page understanding answers only from the synthetic provider.

## What gets sent, and what does not

- On each explicit request, one screenshot of the visible part of the page (with
  detectable form fields blacked out), the numbered link and button list, and
  the typed request go to Gemini through the local Worker.
- Camera video, face landmarks, gaze points, calibration and vitals never leave
  the computer. Gaze has no connection to Gemini.
- Google keeps prompts and responses for abuse monitoring under its own policy
  (Part 1, step 5). Iris holds screenshots in memory only, but that is not a
  promise of zero retention on Google's side.

## Before you start

- A Google account with access to Google AI Studio and the Google Cloud project
  that will pay for Gemini.
- Node.js 22 or newer, Git, and Google Chrome.
- A clone of this repository.
- About $1 of usage at most: the test in Part 5 is a single request.

Never paste the API key, a session token, or billing or project identifiers into
chat, an issue, a pull request, or any committed file.

## Part 1: Google account checks

Record each result in the "Current status" column of the
[readiness record](page-understanding-readiness.md): a short statement and the
date, never keys or private identifiers.

1. **Find the project behind the key.** In Google AI Studio, open the API keys
   page. Note which Google Cloud project the key belongs to. Every check below
   is about that project.
2. **Check the model.** Confirm that `gemini-3.8-flash` (or the model you will
   set in `GEMINI_MODEL`) is listed for the project and accepts image input.
   Part 2 confirms that the key can reach it.
3. **Check the billing tier and data terms.** In AI Studio, see whether the
   project is on a paid or unpaid tier, then read the
   [Gemini API terms](https://ai.google.dev/gemini-api/terms) for that tier. On
   the unpaid tier, Google's terms allow content to be used to improve its
   products. If the project is unpaid, use only public pages, such as the one in
   Part 5, until it is on a paid tier.
4. **Turn off logging and dataset sharing.** Following the
   [logs policy](https://ai.google.dev/gemini-api/docs/logs-policy), check that
   API logging is off for the project and that no logs are shared as datasets.
5. **Read the abuse monitoring policy.** The
   [usage policies](https://ai.google.dev/gemini-api/docs/usage-policies)
   describe how long Google keeps prompts and responses for enforcement. Anyone
   who tries Iris with real content should be told this.
6. **Check credits and automatic payments.** In the Google Cloud console's
   Billing section for the project, note the remaining credit balance and when
   it expires. Check whether automatic reload or prepayment is on, and what is
   charged once the credits run out.
7. **Set a budget alert.** In Billing, create a budget for the project with
   email alerts at low amounts (for example $5, $20 and $50). A budget only
   alerts; it does not stop spending. Also note the per-minute request quota.

Stop here if any check fails or is unclear. Leave `PAGE_CONTENT_APPROVED=false`
until all seven are recorded.

## Part 2: Local server and key check

1. From the repository root, install and build the extension:

   ```sh
   npm ci
   npm run build
   ```

2. Install the server and create its private settings file:

   ```sh
   cd server
   npm ci
   cp .dev.vars.example .dev.vars
   ```

   `.dev.vars` is ignored by Git. On Windows, use `copy` instead of `cp`.
3. Open `server/.dev.vars` in an editor and replace `replace_with_your_key` with
   the API key from AI Studio. Save the file.
4. Check that the key reaches the model and accepts Iris's request format. This
   sends a fixed text prompt and a one-pixel image, and no page content:

   ```sh
   npm run check:gemini
   ```

   Expected: `Gemini connection succeeded`, `Expected reply matched: true` and
   `Page understanding request accepted: true`.
   On an error, see Troubleshooting.

## Part 3: Load the extension

1. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click
   **Load unpacked**, and choose the `extension/dist` folder.
2. Check that the Iris card shows the ID `bohipliohnmknfglnkhglngbmpiahdcn`.
   The ID is pinned in the manifest, so it is the same on every computer. If it
   differs, rebuild from an up-to-date clone.

## Part 4: Server settings and a session token

1. From `server/`, create a 15-minute session token:

   ```sh
   node scripts/provision-demo-session.mjs
   ```

   It prints `sessionToken`, `expiresAt` and `serverBinding`. Keep this terminal
   private. The token is entered in Iris in Part 5; only the `serverBinding`
   goes into the settings file, and it holds a hash, not the token.
2. Edit `server/.dev.vars` so it contains these lines (keep your key line):

   ```sh
   GEMINI_MODEL=gemini-3.8-flash
   ENABLE_PAGE_UNDERSTANDING=true
   PAGE_UNDERSTANDING_PROVIDER=gemini
   PAGE_CONTENT_APPROVED=true
   EXTENSION_ORIGIN=chrome-extension://bohipliohnmknfglnkhglngbmpiahdcn
   DEMO_SESSIONS={"<session id>":{"tokenHash":"<hash>","expiresAt":<number>}}
   ```

   For `DEMO_SESSIONS`, paste the printed `serverBinding` object on one line.
   Any provider other than `synthetic` means real Gemini. Set
   `PAGE_CONTENT_APPROVED=true` only after Part 1 is complete.
3. Start the server and keep the terminal open:

   ```sh
   npm run dev
   ```

   It listens on `http://127.0.0.1:8787` only.

## Part 5: One live request

Use a public page with no personal information. `https://example.com` has one
link, so the right answer is known.

1. Open `https://example.com` in Chrome and keep it the active tab.
2. Click the Iris toolbar icon to open the side panel.
3. In **Page understanding**, enter the gateway `http://127.0.0.1:8787`, click
   **Allow gateway access**, and approve Chrome's prompt.
4. Paste the `sessionToken` from Part 4 into the token field and click **Use
   demo session**. The field clears at once. The token stays entered until it
   expires, Chrome restarts or Iris is reloaded.
5. Type `More information` as the request and click **Send viewport to find
   target**, once.

Expected: a result starting "Recommended target 1. It is highlighted on the
page.", then Gemini's short explanation, and the link outlined on the page.
Nothing is clicked.

This is the only request the test needs. Each session allows two requests a
minute and ten in total.

## Part 6 (optional): Gemini and gaze together

Gemini can describe whatever gaze is aiming at. This uses one more request.

1. In the side panel, turn on **Developer: the mouse stands in for the eyes**,
   or calibrate with **Calibrate on this page** and turn on **Aim with my eyes**.
2. Rest your eyes (or the mouse) on the "More information" link for about a
   second, until it is outlined.
3. Click **What is this? (the target I rested on)** in the side panel. Moving to
   the button does not change the target: Iris uses the one you rested on.

Expected: "Target 1:" and a short description of the link. Nothing is clicked.
Dwelling on the target for one second still opens it, and anything that may
submit, pay, delete or send asks for a second confirm.

Making Gemini's "find" answer the aimed target, ready to confirm, is future work.

## Part 7: Check usage and record the result

1. Within a few minutes, look at the request count in AI Studio for the project.
   Billing reports can take up to a day to show the cost.
2. In the [readiness record](page-understanding-readiness.md), note the date,
   the model, that one live request succeeded, and the usage seen. No keys,
   tokens or identifiers.

## Part 8: Turn it off

1. Stop the server with Ctrl+C.
2. In `server/.dev.vars`, set:

   ```sh
   ENABLE_PAGE_UNDERSTANDING=false
   PAGE_CONTENT_APPROVED=false
   PAGE_UNDERSTANDING_PROVIDER=synthetic
   DEMO_SESSIONS={}
   ```

3. The session token expires on its own within 15 minutes.
4. If the key may have been exposed, delete it in AI Studio and create a new
   one.

## Troubleshooting

| You see | Meaning | What to do |
| --- | --- | --- |
| `check:gemini` reports 403 | The key lacks access to the project or API | Check the key's project in AI Studio |
| `check:gemini` reports 404 | The model is not available to the project | Set another available model in `GEMINI_MODEL` |
| `check:gemini` reports 429, or Iris shows `UPSTREAM_UNAVAILABLE` | Quota or rate limit, or Gemini is unavailable | Wait, then check quota in AI Studio |
| `check:gemini` reports `UPSTREAM_REJECTED`, or Iris shows it | Gemini refused the key, the model or the request format | Check the key and `GEMINI_MODEL`; the HTTP code printed by `check:gemini` narrows it down |
| `NOT_CONFIGURED` | A server setting is missing or malformed | Check the key, `EXTENSION_ORIGIN` and the one-line `DEMO_SESSIONS` JSON, then restart the server |
| `DISABLED` | `ENABLE_PAGE_UNDERSTANDING` is not `true` | Set it and restart |
| `CONTENT_NOT_APPROVED` | Real Gemini selected without approval | Finish Part 1, then set `PAGE_CONTENT_APPROVED=true` |
| `FORBIDDEN` | The request came from a different extension ID | Check Part 3 and `EXTENSION_ORIGIN` |
| `UNAUTHENTICATED` or `DEMO_SESSION_REQUIRED` | The token is wrong or expired | Provision a new token (Part 4) and restart the server |
| `RATE_LIMITED` | More than two requests in a minute, or ten in total | Wait a minute, or provision a new token |
| `PAGE_NOT_ALLOWED` or `UNSUPPORTED_PAGE` | The page cannot be captured (browser page, incognito, video or embedded frames) | Use `https://example.com` |
