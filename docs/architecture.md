# Iris: Architecture

Iris is a Chrome extension that lets people with severe motor impairments browse real websites hands-free. Users aim with their eyes (or head), confirm with a dwell or a long blink, and speak requests to a voice agent. Iris watches for fatigue through the camera and adapts its pace before the user gives up.

Track and technology choices behind this design are in [tracks.md](tracks.md).

**Implementation status: v0.1 private-demo MVP.** The extension has a camera
preview, gaze aiming with on-page calibration, dwell-confirmed selection of
page targets, and an explicit-request page-understanding harness. The Worker implements
authenticated screenshot/target matching, visible-viewport summaries and local
image-crop descriptions. It remains disabled by default and has not been deployed
by this change. Voice browser tools (scrolling, history, summaries, find) are implemented. Long-blink confirms, user-talking signals and the full input-mode state machine below remain
future work. Basic ElevenLabs conversation is implemented; live microphone
testing remains outstanding. Page understanding is built
and tested independently of ElevenLabs. Contracts and exact limits are in
[page-understanding-protocol.md](page-understanding-protocol.md); account and
live-use prerequisites are in [page-understanding-readiness.md](page-understanding-readiness.md).

---

## 1. Context

**Problem.** People with ALS, spinal cord injuries or cerebral palsy often cannot use a mouse or keyboard. Existing eye-control tools move a cursor pixel by pixel, which is jittery on webcams, and they click whatever the user happens to look at (the "Midas touch" problem). Eye control is also tiring, and accuracy drops as the session goes on.

**What Iris does differently.**

| Idea | How |
| :--- | :--- |
| Aim at real targets, not pixels | The extension reads the page, numbers every link and button, and snaps focus to the nearest one. |
| Separate aiming from clicking | Eyes aim. A dwell or a long blink confirms. |
| Say what you want | A voice agent maps "open the history section" to the right target, summarizes pages and describes images. |
| Adapt to fatigue | Body signals (blink rate, heart rate variability, breathing) plus behavior (more "go back" actions, shakier aim) drive a fatigue score. Iris slows down, enlarges targets, then offers to read aloud. |
| Private by default | All camera processing happens on the laptop. No video ever leaves the machine. |

**Scope boundaries.**
- Works on normal websites. Chrome's own pages and the address bar are out of reach for extensions; voice "go to <site>" covers navigation.
- Fatigue is presented as "you might be tired", never as a medical reading.
- Desktop Chrome only.
- The companion targets Apple Silicon Macs, where the demo runs and the companion installer works today. Windows x64, which the Presage Node.js SDK also supports, is a stretch goal for the installer. Intel Macs are not supported.

---

## 2. Technologies / Services

**Voice milestone:** `POST /v0.1/agent-token` accepts an empty JSON object from the
Iris extension on this computer (or with an operator-issued token elsewhere), then returns `{ signedUrl }` for the
server-configured ElevenLabs agent. It requests a single-use conversation
signature. `ENABLE_VOICE_AGENT` is independent of page understanding and defaults
to false. The existing origin checks, in-memory demo rate budget and concurrency
lease apply to minting; they do not cap conversation duration or global spend.
The response is not cached. API keys stay in Worker secrets; signed URLs must
remain in memory and must never be logged. The side panel has a microphone
permission button that opens an extension tab, checks audio-only access and
immediately stops all tracks without sending audio. Start/Stop conversation connects
the side panel to the local Worker's signed-session endpoint and ElevenLabs over
WebSocket through a neutral VoiceAgent interface. Audio worklets ship inside the
extension. Stop and panel closure end the session, including late connections.
Audio is sent to ElevenLabs only after Start; no transcripts are stored or logged.
Browser client tools are described in section 3.2; user-talking signals remain a subsequent milestone.

| Layer | Choice | Role |
| :--- | :--- | :--- |
| Client | Chrome extension, Manifest V3, TypeScript | Side panel (UI, voice agent, gaze tracking), background coordinator, page helper injected into each tab |
| Vitals and face sensing | **Presage SmartSpectra** (Node.js SDK) in a local companion | Heart rate, heart rate variability, breathing rate and waveform, natural blinks, facial expressions and a motion warning, used for slow trends (fatigue, focus), never for confirms. Runs on-device. Presage has no gaze output and no fatigue, focus or movement score; Iris computes those. |
| Companion link | Chrome native messaging | Chrome starts the companion and only Iris's extension can reach it. No open network port. Iris's extension ID is fixed by a public key in its manifest, so the companion can name exactly one allowed caller. |
| Gaze (where the user looks) | MediaPipe Face Landmarker (in the side panel) | Primary aiming source. Eye and head landmarks are mapped to a screen point through the 5-dot calibration. Its per-eye closure drives the long-blink confirm. The WebAssembly runtime and model are bundled with the extension. |
| Voice | **ElevenLabs Agents** with client tools | Hands-free conversation with turn-taking; calls Iris actions as tools; tells Iris when the user is talking |
| Fixed voice lines | ElevenLabs text-to-speech | Backup for short system lines if the agent connection fails |
| Page understanding | **Gemini API** (Flash models, image input) | Matches spoken requests to numbered targets using a screenshot plus the target list, summarizes pages, describes images |
| API gateway | Cloudflare Worker | Holds every API key; mints the ElevenLabs agent session; proxies Gemini |
| Fatigue history (optional) | Tiger Data (managed Postgres with time-series) | Opt-in minute-level fatigue summaries for a caregiver trends view |
| Shared logic | Plain TypeScript package | Target snapping, input modes, fatigue score, focus score, movement level, calibration fit. No vendor imports. |

**Vendor isolation.** Every vendor sits behind a neutral interface so it can be swapped without touching callers:

| Interface | Implementations |
| :--- | :--- |
| `GazeProvider` (where the user looks, eye closure for the long-blink confirm) | MediaPipe, simulated |
| `FaceProvider` (blink events for blink rate, expressions, motion warning, face points) | Presage companion, simulated |
| `VitalsProvider` (HR, HRV, breathing rate) | Presage companion, simulated |
| `VoiceAgent` (conversation, user talking on/off) | ElevenLabs Agents |
| `PageUnderstanding` | Gemini |
| `SessionStore` | In memory (simulated), local only, Tiger Data through the Worker |

---

## 3. Data Flow Design

### 3.1 Sensing loop (on the laptop)

```
Webcam ─> Iris Companion (Node.js, Presage SDK)
            ├─ blink frames ───> BlinkSegmenter ─> blink events (for blink rate)
            └─ HR, HRV, breathing rate, expressions, motion warning, quality hints
                 │ native messaging (small JSON events, no video)
                 ▼
        Background coordinator ── input mode state machine ── click(target)
          ├─ FatigueEngine, FocusEngine, movement (packages/core)
          ├─ LongBlinkDetector, dwell timer (packages/core) ─> confirm events
          ▲
          │ gaze points (screen coordinates), eye closure, user talking on/off
Webcam ─> Side panel: MediaPipe Face Landmarker ─> calibration fit
                     ─> snap aim to nearest target (packages/core)
Mic ────> Side panel: ElevenLabs agent ─> requests, user talking on/off
                 │ aimed target number only
                 ▼
        Page helper: numbered overlay, click, scroll,
                     enlarge text and targets when fatigue rises
```

**Who owns what.**
- **Where the user looks:** MediaPipe only. The calibration fit and target snapping live in `packages/core/`.
- **Confirms:** a dwell or a long blink, never Presage. The long blink comes from MediaPipe's per-eye closure: a closure under 400 ms is an ordinary blink, and only a closure held well past that confirms. Both eyes must close for about 0.7 to 2 seconds and open again on the same aimed target; the confirm fires on opening. A wink, a lost face (which reads as open), resting the eyes longer, or a closure during which the aim moved never confirms. A long blink goes through the same selection gate as a dwell, so risky targets still need a second confirm. Voice requests pick a target but never confirm it. Every confirm method produces the same event, so swapping one for another changes nothing downstream; dwell fires once when one target stays aimed for one second (adjustable) with the eyes open. A confirm acts on the target aimed at that moment: a safe target is selected at once, and a risky one only by a second confirm on the same target within six seconds, however it was proposed. Looking away does not cancel it, since a second dwell needs the eyes to leave and return, so staring at a risky target never selects it.
- **Blink rate:** Presage only. Presage reports blinking as a per-frame flag; the companion groups those frames into single blink events for the fatigue score. MediaPipe answers "did the user close their eyes on purpose", Presage answers "how often is the user blinking", so the two never compete. Core drops a Presage blink that coincides with a confirm, so confirms do not count as fatigue.
- **Talking:** the ElevenLabs agent, which hears the microphone. Presage's talking flag is not used. With no voice session open, Iris has no talking signal; fatigue readings get slightly noisier, and no confirm depends on it.
- **Fatigue, focus and movement:** computed by Iris in the background coordinator from Presage signals plus behavior that only the extension sees. Presage provides the raw signals, not these scores.

Presage was tested on the demo laptop before these choices were made (#24). Its blink flag reports every blink at about the same length however long the eyes stay closed, and it missed 4 of 10 prompted blinks. Its talking flag was on more often during silence than during speech. Normal pauses between breaths at rest lasted as long as deliberate breath holds. Presage expects a still, quiet user, and its readings degrade when talking, blinking and breathing changes happen together, so it is used for slow trends only.

**Page targets for gaze.** The side panel keeps the active tab's numbered targets current: four times a second it reads the page's change counter, and rescans only when the tab, the document or the counter moves. Gaze uses a targets-only scan of links and buttons that carries positions but no labels and none of the screenshot blocking rules, since nothing from it leaves the extension; page understanding keeps its full scan. Each gaze target also says whether selecting it needs a second confirm: only an ordinary link to another web page, or a plainly harmless button outside a form, is safe; anything that may submit, pay, delete or send, and anything Iris cannot classify, is risky. The label is read inside the page to decide and is never returned. Snapping runs in the side panel, next to the tracker: each smoothed gaze point snaps to the nearest target in the current list, and the page's numbers are redrawn only when the aimed target changes. A live gaze cursor, a red ring at the smoothed gaze point, follows the user's gaze on the page whenever aiming runs: the side panel streams the point over one open connection to Iris's overlay, which moves the ring inside its closed shadow root, so page scripts cannot read where the user looks. The point never leaves the computer, and the cursor hides while the eyes are closed or the face is lost. Numbers, the aimed target and the cursor are drawn by an overlay that only draws and is never in a screenshot. Numbers stay through page changes that move nothing (hover effects, ads, ticking clocks): once per frame the overlay checks the elements behind the gaze scan, and erases the numbers only when one has moved more than 4 px or left the page; the next scan redraws them. Page understanding's highlight is erased by any page change.

**Camera sharing.** The companion and the side panel each open the webcam. Both must run at once. This was verified on the demo laptop (#24) and is checked on every other target machine. On macOS, Chrome does not pass its own camera permission to the programs it starts, so the companion runs inside a small app, `Iris Companion.app`: its launcher (`companion/install/launcher.c`) starts Node as a child process, and macOS asks once whether Iris Companion may use the camera. If sharing fails, the companion owns the camera, feeds Presage through its custom input path, and forwards downscaled frames to the side panel for MediaPipe over native messaging (each message to the extension is capped at 1 MB).

**Companion messages.** Defined in `packages/protocol/src/companion.ts`, and every message is validated on arrival on both sides. The extension sends `start` and `stop`. The companion sends `hello` (its protocol version, checked by the extension), `status` (running, key missing, offline, credits exhausted and so on), `quality` (camera view problems with a hint to show), `vitals` (pulse, breathing rate and HRV, each with confidence and a stable flag, about once a second) and `blink` (each natural blink's length). Messages carry no timestamps; the receiver stamps them, so the two programs' clocks never need to agree. The side panel holds the connection (`extension/src/providers/companion/`), next to the gaze session that will use the signals. Opening the panel starts the companion, and closing the panel closes the port, which ends the companion and Presage with it, so body sensing never runs in the background. A dropped connection is not retried on its own, since every new session repeats Presage's warm-up and uses credits.

**MediaPipe gaze.** In the side panel, MediaPipe Face Landmarker runs on each camera frame. The iris center (averaged with its four contour points) is measured along the line between the eye corners and as an offset from that line; up and down are blended with the model's look-down and look-up scores, where landmark geometry is weakest; the face transform gives head yaw and pitch, and the outer eye corners give the head's position and apparent size. Each eye is read on its own: an eye whose lid is closed drops out, and the two are weighted by their apparent width, so a drooping lid, a wink or an eye turned away from the camera does not pull the estimate. A closure shorter than 400 ms is a blink, not a closed eye: the sample and the iris markers hold still through it, since the iris under a closing lid is not worth reading. The camera is opened at 1280x720 so that iris movement spans enough pixels to measure against landmark noise. The calibration fit maps the eye feature alone to the screen; head movement is not learned (the user holds still during calibration) but corrected geometrically afterwards: the fitted point is shifted by how far the head has moved sideways and by the viewing distance times the tangent of how far it has turned, using a 9 cm outer eye-corner span as the ruler and a 60 cm seat distance at calibration. The fit is kept as raw samples rather than weights and refitted whenever one is added: the dots are the anchor, and every target the user confirms during use adds a sample taken in whatever head position they were in, which is the coverage a still-head calibration never has. A confirm only counts when the current fit already places the gaze near that target, so a wrong selection cannot pull the map away. Samples (a few numbers each, no frames or landmarks) are saved on the device, keyed by screen size and scaling, so a returning user is tracked at once and the dots are only shown when no saved calibration fits the screen. In the extension the dots are drawn over the browsing tab and each is saved in screen positions, its place on the page plus the window's position, so moving the window or resizing the side panel needs no new dots; a side panel on the left that gets resized, or page zoom other than 100%, does, and confirms absorb small errors. These are published as `GazeProvider` samples, and nothing MediaPipe-specific leaves the provider. While both eyes are closed a sample carries no eye position, so aiming holds still. The missing position is not a blink signal; the long-blink confirm reads the per-eye closure carried in each sample instead. The WebAssembly runtime and model ship inside the extension (the model is pinned by SHA-256), so nothing loads remotely and no frames leave the page.

**Gaze accuracy across postures.** MediaPipe tracks faces turned or tilted, but iris points get less reliable past roughly 35 degrees of turn, and its head pose assumes a generic camera (63 degree vertical field of view). The larger source of error is Iris's own mapping: the eye is read flat in the camera image and mapped to the screen by a fit made at one posture, with movement since then corrected from fixed assumptions (60 cm seat distance, 9 cm eye-corner span, a 1/96 inch CSS pixel). Tilting the lid or changing seat therefore moves the gaze point. The design separates the two things that decide where gaze lands, as gaze research does: which way the eyes point, read independently of head pose, and where the head is, used once in the step that finds the spot on the screen. The screen geometry a browser cannot know (lens, screen size, true distance) is learned from use rather than assumed. Selection stays target-based; the cursor is feedback. The work is staged so each step is measured against the last:

| Stage | What it adds |
| :--- | :--- |
| Measure | **Check accuracy** shows nine dots inside the calibration grid and reports mean, worst, left-right and up-down error and the head posture. The last ten checks per screen are kept with their samples (numbers only, on this computer), so later fits can be scored on the same data. |
| Learn from use | Every gaze selection adds a calibration sample for the selected target's center, from the eyes during the dwell. Recent confirms count most (each starts at ten dot samples and halves every ten confirms), and a confirm of the target gaze snapped to is trusted further than an arbitrary one, so a drifted fit can be pulled back. Mouse pointing never teaches the eye calibration. |
| Posture-aware map | Head turn, tilt, position and distance (from iris diameter, about 1.2 cm) become inputs to the fit, with today's geometric correction as the starting point and a learned adjustment on top. |
| Posture-independent eye reading | Head rotation is undone before the iris is read between the eye corners; eyelid opening is added as a vertical cue. Lives in the MediaPipe adapter. |
| Posture change | A sudden large change in head pose or distance offers a three-dot touch-up instead of a full calibration. |
| Accuracy-aware selection | The snap radius follows measured error, and targets too close to tell apart are separated or resolved from the user's request. |

The first two stages are built. A neural gaze model is out of scope unless measurements show this approach has reached its limit.

**Fatigue score.** Combines slow body signals (blink rate up, heart rate variability down, breathing rate) with behavior (back-after-click rate, aim steadiness, time to click). It is computed against the user's own resting baseline, uses hysteresis so it does not flicker, and is paused while the voice agent hears the user talking.

| Fatigue level | Iris response |
| :--- | :--- |
| Fresh | Normal confirm timing and target size |
| Tiring | Longer confirm timing, larger targets |
| Fatigued | Agent offers to read the page aloud and take requests by voice |
| Sustained strain | Suggests a break; pauses gaze confirms until the user looks back |

**Movement level.** Derived from frame-to-frame change in Presage face points plus its "excessive motion" warning. High movement lowers trust in the other body signals and can mean the user is restless or uncomfortable.

**Focus score.** Combines how steady the gaze is on the page, blink pattern, movement level and Presage facial expressions. Like fatigue, it is computed against the user's own baseline and is never shown as a medical reading.

**Presage signal limits** (from the SmartSpectra docs, confirmed on the demo laptop in #24). Readings carry a confidence value and only become trustworthy after a warm-up: 12 seconds for pulse, 30 seconds for breathing, 60 seconds for heart rate variability. Breathing needs the upper chest in view and a still camera, and talking distorts it. Iris ignores readings below their stable threshold, pauses breathing-based signals while the voice agent hears the user talking, and uses these signals only for slow trends (fatigue, focus), never for confirms.

### 3.2 Voice request flow

```
User speaks ─> ElevenLabs Agent (side panel, signed session from the local server;
               its language model is set to Gemini in the ElevenLabs agent settings)
                 └─ calls a client tool, for example find_on_page("history section")
                      └─ helper supplies viewport targets, masks and document revision
                      └─ coordinator captures viewport through Chrome, masks locally
                      └─ local server /v0.1/page-understanding/find_target
                           ─> Gemini ─> validated supplied target ID or null
                 └─ outlines target 12 and answers "It is number 12 ..."
User looks at 12 and confirms (dwell / long blink) ─> page helper clicks target 12
```

**Client tools** (`extension/src/sidepanel/agent/tools.ts`, behind the neutral
`VoiceTools` type; the ElevenLabs SDK is used only in `agent/elevenlabs.ts`):

| Tool | Parameters | What Iris does |
| :--- | :--- | :--- |
| `scroll_page` | `direction`: `down`, `up`, `top`, `bottom` | Scrolls the active tab by most of a screen, or to an end; says when already there |
| `navigate_history` | `direction`: `back`, `forward` | Goes back or forward in the active tab's history |
| `summarize_page` | none | Page understanding summary of the visible viewport |
| `describe_looked_at` | none | Describes the target gaze last rested on (`describe_target`) |
| `find_on_page` | `description` (up to 500 characters) | Finds and outlines a target, and answers with its number |

Each tool answers in words the agent can say, and the side panel shows the same
words. Scrolling and history change the page at once; nothing a tool does
clicks, submits or types. Summaries, descriptions and finding send the visible
viewport to Gemini because the user asked, and their text (never screenshot
bytes) goes to the voice agent, marked as page content that is information only,
never instructions. Agent setup is in [voice-agent-setup.md](voice-agent-setup.md).

**Later client tools:** `describe_image(n)`, `set_pace(slower|faster)`, Gemini's
found target becoming the aimed target ready to confirm, and bounded multi-step
tasks in which Gemini picks each next safe step. A `click_target(n)` tool may
only enqueue an Iris confirmation request; it may never execute directly.

**Safety rule.** Every browser click requires Iris confirmation, even when the
agent proposes it. Gemini recommends/explains only; it never clicks. The one
place Iris clicks is the page helper's select step, after a confirm passes the
selection gate: it clicks only the exact element behind the confirmed number in
that gaze scan, only if it is still on the page, where the user saw it and not
covered, and a risky element only after a second confirm, checked again in the
page itself.

**v0.1 ownership.** The isolated-world helper owns visible links/buttons/images,
sensitive rectangles and revisions, and numbers targets exactly as the gaze scan
does. Chrome capture runs through the background broker; during capture the
overlay is held clear, so gaze cannot draw Iris's numbers into the screenshot. The side-panel coordinator owns transient mask/crop canvases, capture
consistency checks and plain-text results. The background owns HTTP to the Iris server on this computer, which holds every key; the extension holds no token or key. It rejects broker
messages from content scripts and other extension pages. An in-memory limiter manages session rate/concurrency within each Worker instance;
there is no database or distributed coordination in this smaller MVP. The Worker
validates bounded PNGs and model output independently of the Gemini schema.
Only the visible viewport is understood; summaries deterministically disclose
this. Describe-image sends a locally masked crop for a revision-bound image ID,
never a URL to fetch. "What is this?" connects gaze to Gemini: it sends a masked
crop around the target gaze last rested on, outlined, and shows Gemini's short
description; gaze and page understanding number targets identically, so the
aimed number is checked against a fresh snapshot before anything is sent. Unsupported frames/custom controls/video/animations and
pinch zoom fail closed; detectable capture races and stale results are discarded.

### 3.3 Data handling rules

- Video and face landmarks never leave the laptop. Presage computes on-device. It contacts its backend to validate the API key and, when its processing model is not bundled, to download that model; it does not send video or readings. The companion turns Presage telemetry off (`enableTelemetry: false`) and does not use Presage LLM Insights, which would send measurements off the laptop.
- Heart, breathing and blink data live in memory only.
- If Tiger Data is enabled: strictly opt-in. Each stored row is a one-minute summary: fatigue score, fatigue level, click count and back-after-click count. Rows carry a random anonymous profile ID (made on the laptop at opt-in, resettable) plus a random session ID, so a caregiver can compare weeks without any name. Heart, breathing and blink data, page URLs and names are never stored. Raw minutes are deleted after 90 days. The database connection string is a Worker secret. Schema: `server/db/`.
- All API keys live in Worker secrets. The extension holds none. The one exception is the Presage key, which the SDK needs on-device: the companion reads it from the operating system keychain at startup, holds it in memory only, and never writes it to code, logs or config files.
- Page screenshots/crops are sent only on an explicit user request. Iris handles
  them transiently in memory: no logging, persistence, caching, queues or
  observability payload capture. Detectable editable fields are masked locally;
  masking cannot guarantee removal of all private information. Incognito and
  restricted browser pages are blocked. Camera video still never leaves the laptop.
- Google has separate data-handling/retention rules. The actual project's terms,
  logging/sharing and retention configuration must be verified before real browsing
  content is used; Iris does not promise zero provider retention.
- The server on the user's computer admits a request without a token only when it
  reaches the loopback address with the exact `EXTENSION_ORIGIN`, which web pages
  cannot send. Any other request (a server reached from elsewhere) uses
  operator-provisioned, participant-specific random tokens with a fixed 15-minute
  expiry; only hashes/expiry are configured server-side. Tokens are privately
  handed to verified participants. The extension embeds no vendor keys/shared
  reusable secrets and persists no credentials.
- The Worker bounds inputs, outputs, streamed parsing and deadlines. Per Worker
  instance: one in-flight request/session, 2/minute/session and 10/session for
  token holders, and one in flight and 10/minute with no total cap for the local
  extension, with no automatic retries/renewal. Cold starts reset counters and different instances
  enforce independently. Global concurrency/rate limits and participant daily
  quotas are deferred to the team's authentication/storage work. No database,
  Durable Object, KV binding, migration or IndexedDB is introduced by this MVP.
- The reported $60 Gemini credits and auto-reload-off belief are unverified.
  Verify billing before relying on it; an exact global spending cap is deferred.

---

## 4. System Approach

**Principles**
1. **Targets, not pixels.** Aim always snaps to a real, numbered page element.
2. **Aim and confirm are separate.** No click happens from looking alone.
3. **One intent at a time.** An input mode state machine (`idle → aiming → confirming → listening → acting → speaking`) keeps eyes, blinks, dwell and voice from colliding.
4. **Sensors are plugins.** Every sensor publishes normalized events through its interface; a simulated provider plugs in the same way for development without a camera.
5. **Show the why.** A side-panel feed tells the user what Iris noticed and what it changed ("Blink rate up 40%, slowing clicks").

**Input options (user chooses)**

| To... | Default | Alternatives |
| :--- | :--- | :--- |
| Aim | Eyes | Head pointing |
| Confirm | Dwell | Long blink |
| Scroll | Look at the top or bottom edge band | Voice |
| Navigate by intent | Voice request | Aim and confirm |
| Read | Voice "read this" | Read zone |

**Setup flow**
1. Camera and microphone permission, requested once from an extension tab page (a side panel may not show the permission prompt); the side panel then reuses the grant.
2. Website access, granted once from a side panel button, so Iris keeps working after a link to another site (Chrome's `activeTab` access ends there). It is used only to read target positions and draw numbers on the page.
3. Lighting check.
4. Calibration on the page: the side panel's **Calibrate on this page** shows 9 dots over the browsing tab (about 16 seconds), then aiming with the eyes starts.
5. Long-blink practice (optional; dwell works without it).
6. A default resting profile is used until a personal baseline has built up.

---

## 5. Directory Tree

The tree below includes future modules. Currently implemented page understanding
lives in `extension/src/page-understanding/` (helper, coordinator, masking and
session client), `server/src/{access,http,png,multimodal}.ts`,
and `packages/protocol/src/page-understanding.ts`. Page understanding always uses
real Gemini; Gemini is stood in for only inside automated tests (direct adapters
and routes, capture races and a database-free local Worker run).

```
iris_sentinel/
├── docs/
│   ├── architecture.md          # this file
│   └── tracks.md                # track and technology analysis
├── extension/                   # Chrome extension (Manifest V3)
│   └── src/
│       ├── background/          # coordinator, input mode state
│       ├── sidepanel/
│       │   ├── agent/           # ElevenLabs agent session and client tool definitions
│       │   └── setup/           # permissions, lighting, calibration, long-blink practice
│       ├── content/             # target finder, numbered overlay, click/scroll, enlarge, screenshot
│       └── providers/           # MediaPipe gaze, simulated sensors, companion link (native messaging)
├── companion/                   # Node.js helper running Presage (its own npm project, bundled to one file)
│   ├── src/
│   │   ├── main.ts, host.ts     # entry point and message loop (answers only the Iris extension)
│   │   ├── presage/             # SDK session behind FaceProvider / VitalsProvider
│   │   ├── messaging/           # native messaging framing (length-prefixed JSON)
│   │   ├── secrets/             # reads the Presage key from the OS keychain
│   │   └── detectors/           # blink segmenter (blink events for blink rate)
│   └── install/                 # builds Iris Companion.app and registers it with Chrome (macOS; Windows is a stretch goal)
├── server/                      # Cloudflare Worker, holds all keys
│   ├── db/                      # Tiger Data schema (SQL) and dev seed
│   └── src/
│       └── routes/
│           ├── agent-token/     # signed ElevenLabs agent session
│           ├── gemini/          # find target, summarize, describe image
│           └── tts/             # fixed voice lines
├── packages/
│   ├── core/                    # target snapping, input modes, fatigue, focus, movement, calibration fit
│   └── protocol/                # message types shared by companion, extension, server
└── tests/
    ├── core/                    # unit tests for packages/core
    └── e2e/                     # end-to-end flows with simulated sensors
```

Optional Tiger Data support adds `server/src/routes/sessions/` and a trends view in the side panel.
