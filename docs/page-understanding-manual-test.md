# v0.1 private-demo MVP: incremental manual testing

This first pass tests the Chrome/Worker pipeline using a synthetic provider.
It does not evaluate Gemini's actual matching or summaries. The launcher never
reads `.dev.vars`, supplies no vendor keys, blocks every external Worker request,
uses no database, and serves only a synthetic fixture on loopback.

1. Run `npm run build` at the root. In Chrome's `chrome://extensions`, enable
   Developer mode, **Load unpacked**, and select `extension/dist`. Reload Iris
   if already loaded. Copy its 32-letter ID.
2. Use Node 22 or newer. From `server/`, run:
   `node scripts/manual-demo.mjs <extension-ID>`.
   Keep this terminal open. The private token it prints expires in 15 minutes;
   do not paste it into chat or save/capture it. Ctrl+C stops both local servers.
3. Open `http://127.0.0.1:8765/` in Chrome, click Iris's toolbar icon, and keep
   this page active. Camera permission is optional for page understanding.
4. Enter gateway `http://127.0.0.1:8787`, click **Allow gateway access** and
   approve the local host permission. Enter the terminal's token in the password
   field and click **Use demo session**. Its input clears immediately.

Try these cases, allowing for the two-request/minute limit shared by all operations:

| Try | Expected |
| --- | --- |
| Find `History` | Synthetic no-match response; no actual Gemini match, no click, no highlight. A real match draws every target number on the page and outlines the recommended target; scrolling or any page change erases them |
| Summarize | Explicit `Visible viewport only:` disclosure and synthetic response |
| Third request within a minute | `RATE_LIMITED`, no automatic retry |
| List image numbers, then describe image 1 after the minute window clears | Synthetic crop description; no URL fetching |
| Describe an image before listing or after scrolling/changing the page | Rejected image list/stale snapshot |
| Cancel while the two-second response is pending | Cancelled result; no later displayed recommendation |
| Switch tab, scroll or change fixture text during a pending request | Result discarded/cancelled |
| Start the fixture's capture race, then request understanding | Changed-page rejection; reload to stop the race |
| Add unsupported iframe, then request | `UNSUPPORTED_PAGE`; reload to clear it |
| Browser internal page or incognito | No capture/transmission; incognito extension is disabled |
| Incorrect token, or the token after its 15-minute expiry | `UNAUTHENTICATED`; no provider result |

Canceled/timed-out requests hold the local concurrency lease for up to 45 seconds.
Restarting the launcher creates a new token and resets per-instance counters;
enter the new token in Iris. This reset is a known database-free demo limitation.

For this synthetic fixture only, a tester may inspect the outgoing PNG in Chrome
DevTools memory to verify opaque field masks, numbered targets, correct crop and
zoom mapping. Do not save/export network traces or screenshots, and do not use
real browsing content for this inspection. The fixture's synthetic input,
password, payment, textarea and editable text must be masked before transmission.
The image-description request must contain only the visible image crop.

Record which cases passed and any visible error codes. Actual Chrome checks are
pending until performed by the tester; automated tests are not evidence they ran.
Later Gemini accuracy checks require separate deliberate approval and provider/
billing verification from [the readiness record](page-understanding-readiness.md).
The sub-PRs are drafts for incremental review and testing, each under 300 changed
lines. Browser checks remain pending; review their results before merging the UI
and manual-demo changes.
