# PageUnderstanding v0.1 private-demo MVP

The authoritative types and runtime validators live in
`packages/protocol/src/page-understanding.ts`. The extension and Worker import
the same source; the server's separate package bundles that relative import.
This protocol recommends or explains. It contains no browser action operation.

## Routes and envelopes

`POST /v0.1/page-understanding/{operation}` accepts JSON from the Iris extension on
this computer, or with `Authorization: Bearer <short-lived session token>` on a
server reached from elsewhere (see Provisioning below). Supported operations:

| Operation | Required operation fields | Result fields |
| --- | --- | --- |
| `find_target` | `request`, `targets`, `targetsTruncated` | `operation`, `targetId` (supplied ID or null), `explanation` |
| `summarize_page` | none | `operation`, `scope: "visible_viewport"`, `summary` |
| `describe_image` | `imageId`, `sourceRect` | `operation`, same `imageId`, `description` |
| `describe_target` | `targets` (exactly one), `targetId` (that target's ID), `sourceRect` | `operation`, same `targetId`, `description` |

All requests require `protocolVersion: "0.1"`, `requestId`, `operation`,
`binding`, and one `image`. Unknown fields, including URLs/selectors/actions,
are rejected at every owned object level. Operation fields cannot be mixed.
Results return `{protocolVersion, requestId, binding, result}`. The server echoes
the validated binding; it does not claim to authenticate browser state.
The extension independently validates and checks current state before display.
The server prefixes summary text with `Visible viewport only:` independently of
model compliance, keeping the total within 2000 characters.

`binding` contains opaque `tabToken`, `documentToken`, `captureId`, nonnegative
integer `revision`, and `viewport`. Tokens are 16–80 characters of ASCII
letters, digits, underscore or hyphen. Chrome tab IDs and DOM references stay
local. Each capture has a fresh token. The document token changes on navigation.

`viewport` contains finite `width`, `height`, `offsetLeft`, `offsetTop`, `scale`,
`scrollX`, `scrollY`. Rectangles contain `x`, `y`, `width`, `height` in visual
viewport CSS pixels, clipped to viewport bounds. Screenshot coordinates scale
independently by actual bitmap width/viewport width and height/viewport height.
Browser zoom is supported through measured ratios; visual/pinch zoom (`scale`
other than 1) is blocked in the current capture helper.

Each target has a unique positive safe-integer `id`, `role: "link"|"button"`,
`rect`, and an optional nonempty `label` (at most 200 characters). Icon-only
targets omit the label. The extension masks the bitmap first, resizes, then
draws target IDs into the screenshot. Iris's on-page number overlay is erased
before every capture, so the bitmap shows only the page. Gemini never supplies click coordinates.
Up to 100 visible targets are supplied; `targetsTruncated` discloses truncation.

An image is `{mimeType: "image/png", data: <canonical base64>, width, height}`.
No data URL, image URL, multipart upload, or server image fetching is supported.
For `describe_image`, the extension must first list visible image IDs and bind
that list to the same snapshot. It crops the masked viewport using `sourceRect`;
only the visible portion is described. Image bytes contain no target overlay.
For `describe_target`, the extension uses the target the user last rested gaze (or
the development mouse stand-in) on for about a second, so targets passed over on
the way to the side panel do not count. It must still be in the same document, at
the same number and within 4 px of where gaze saw it. The crop is that target with
room around it (at least 240 by 160 CSS pixels, inside the viewport), masked like
any capture, with one drawn outline marking the target; no other overlay is drawn.
The description is at most 1500 characters. Nothing is clicked.

## Limits and errors

| Boundary | Limit |
| --- | --- |
| HTTP request | 1.5 MiB streamed; JSON only; no Content-Encoding |
| PNG | 1 MiB file bytes; 2048 pixels/side; 3 million pixels |
| PNG encoding | 8-bit RGB/RGBA, noninterlaced; valid chunk CRCs, bounded inflate and scanline filters; no animation/text chunks |
| Request text | 500 characters |
| Explanation / summary / image description | 500 / 2000 / 1500 characters |
| Gemini response | 256 KiB streamed; generated text at most 8192 characters before parsing |
| Ingestion / upstream / request | 5 / 30 / 40 seconds |
| Generation | 2048 maximum output tokens, low thinking; one call, no retries/fallback |

JSON and image validation precede Gemini. Runtime output validation is
independent of Gemini's structured-output schema and also applies to fake
adapters. Provider function calls, incomplete outputs, wrong operation/image
IDs, invented target IDs and unknown generated fields fail validation.

Errors are `{error: {code}}`, with no provider body, model text or credentials.
Codes include `INVALID_INPUT`, `INVALID_IMAGE`, `USE_JSON`,
`UNSUPPORTED_ENCODING`, `BODY_TOO_LARGE`, `UNAUTHENTICATED`, `FORBIDDEN`,
`RATE_LIMITED`, `REQUEST_IN_FLIGHT`, `TIMEOUT`, `UPSTREAM_UNAVAILABLE` (busy or
over quota), `UPSTREAM_REJECTED` (key, model or request format refused),
`INVALID_MODEL_RESULT`, `NOT_CONFIGURED`, `DISABLED`, `CONTENT_NOT_APPROVED`,
`UNAVAILABLE`, `USE_POST`, and `NOT_FOUND`. All responses use
`Cache-Control: no-store`. Limit responses include `Retry-After`; clients do not
retry automatically. Extension-local errors also report page changes,
unsupported pages, missing image lists, cancellation and permission failures.

## Provisioning and resource ownership

The server normally runs on the user's computer. A request there needs no token
when it reaches the loopback address with the exact `EXTENSION_ORIGIN`, which web
pages cannot send; such requests may run one at a time, 10 a minute. The
extension sends no `Authorization` header and stores no credential.

For a server reached from another computer there are no authentication bootstrap
or registration endpoints. A trusted operator runs `node server/scripts/provision-demo-session.mjs`
locally to create a cryptographically random, participant-specific bearer token
and a fixed 15-minute expiry. The operator adds only the returned `serverBinding`
(session ID -> `{tokenHash, expiresAt}`) to the server's ignored `DEMO_SESSIONS`
configuration, then hands the token privately to the verified participant.
Never paste tokens into chat, source code, logs or shared fixtures.

The extension has no token entry; tokens are for clients of a non-local server.
There are no embedded vendor keys, reusable shared secrets, signing keys,
IndexedDB or other credential persistence. Removing a token's server entry
revokes it. TLS is required except localhost. The server verifies
expiry on every request and rejects provisioning more than 15 minutes ahead.

Admission uses an in-memory map per Worker instance, with no database, Durable
Object, KV binding or migration. Within one instance it reserves a lease without
an intervening await, permits one request in flight per session, two attempts per
minute and ten attempts per provisioned session. Admitted failures count.
Timeout/cancellation keeps the conservative 45-second lease until expiry.
Expired/revoked entries are pruned. Re-entering a token does not reset counters
within that instance. The operator provisions at most 20 sessions and issues new
sessions deliberately; there is no automatic renewal.

**Private-demo limitation:** cold starts reset counters and different Worker
instances enforce independent limits. Concurrency and rate limits are not global;
there is no daily participant quota or globally exact spending ceiling. The
extension also serializes requests locally. Keep deployment disabled and use a
small manually supervised demo. Distributed enforcement is future work owned by
the team's authentication/storage integration, not this MVP.

The worker has no page payload logging, caching, queues or background payload
processing. Only transient memory is used for session accounting; no page data is retained there.
Global exact spending caps are deferred; provider cancellation may not stop
processing/billing. The operator must protect Cloudflare administrative access
and provision only a small, verified demo group. This is not public signup.

## Extension and future voice boundary

The isolated-world helper enumerates visible top-document links/buttons/images
and open shadow roots, collects sensitive rectangles, and tracks revisions.
Visible embedded frames, inaccessible custom elements, video, running
animations, oversized DOMs and unsupported viewport geometry fail closed.
The coordinator checks snapshots around capture/processing and polls during HTTP.
Document, geometry, field bounds, scroll, tab or revision changes cancel/discard
the result. DOM reads and Chrome capture are not atomic: undetected pixel changes
remain possible and arbitrary private information cannot be guaranteed removed.

The background broker alone holds runtime session tokens and sends authenticated HTTP; it
accepts privileged messages only from this extension's sidepanel page.
The side-panel coordinator owns transient canvases and final presentation.
Raw captures are passed transiently between these two trusted extension contexts,
masked locally, never exposed to page scripts or voice tools, and released when
the request ends. Bitmap/canvas resources are explicitly closed/reset. JavaScript
does not guarantee secure memory erasure.

Future ElevenLabs client tools call this coordinator, with user-authorized
`find_target(description)`, `summarize_page()`, or `describe_image(id)`.
Their outputs contain bounded text, validated IDs, status and snapshot binding,
never screenshot/crop bytes. Model output is plain text and untrusted.
Future click tools may only enqueue an Iris confirmation proposal. Every click
requires Iris confirmation; model-supplied approval has no authority. Confirmation
must be invalidated on a changed document/target. Action-layer tests must cover
forged confirmation, replay, direct tool calls, stale targets and prompt injection.
