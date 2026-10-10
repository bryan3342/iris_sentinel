# Iris: Track and Technology Analysis (Hack Knight Fall 2026)

## Context

**Current delivery: v0.1 private-demo MVP.** Page understanding is implemented
and tested independently of ElevenLabs: explicit-request viewport screenshots,
numbered target recommendations (including unlabeled icons), viewport summaries,
and locally masked image crops. Authentication is manually provisioned; conservative
per-instance rate/concurrency limits reduce quota exposure. No database is required;
cold starts reset counters and distributed enforcement is deferred. Gemini explains/recommends only.
No browser action or voice confirmation flow is implemented in this milestone.
The feature stays disabled until provisioned. Real browsing content/live calls
require provider data-handling and billing verification; $60 credits and
auto-reload-off are user-reported and unverified. See the
[protocol](page-understanding-protocol.md) and [readiness record](page-understanding-readiness.md).

Sources: the hackknight.org public API (sponsors) and the Hack Knight Fall 2026 Devpost page (prizes, judging criteria). Iris is a Chrome extension with a local Presage companion (see [architecture.md](architecture.md)). This review checks every prize track and sponsor technology against Iris's mission: hands-free browsing for people with severe motor impairments. It keeps what fits, swaps what fits better, and drops what doesn't.

**Facts that shape scope**

| Fact | Impact |
| :--- | :--- |
| Judging criteria: Creativity, Completeness, Presentation, Alignment With Track, Design. | Completeness counts, so every sponsor added must actually work. Fewer, deeper integrations win. |
| The MLH hardware lab has 8 Logitech webcams. | An external webcam gives steadier heart, breathing and eye readings than a laptop camera. |
| ElevenLabs is a Gold sponsor, and Best Overall also awards ElevenLabs Pro. | ElevenLabs is a strong bet. |

---

## 1. Every track, scored for Iris

| Track | Fit | Decision |
| :--- | :--- | :--- |
| **Best Health Hack** | Direct: accessibility for motor-impaired users | **Primary target** |
| **Best Overall / Runner-up** | Automatic if the product is strong | Target |
| **[MLH] Best Use of Presage** | Their brief lists "Accessibility" by name. Camera-based fatigue sensing (heart rate, breathing, HRV, blink rate) that slows Iris down before the user gives up is a near-perfect match. | **Core** |
| **[MLH] Best Use of ElevenLabs** | Voice is how users speak requests and how Iris reads to tired users | **Core**, upgraded (section 2) |
| **[MLH] Best Use of Gemini API** | Sees and understands the page; beats Snowflake at the jobs we gave Snowflake | **Add** (replaces Snowflake) |
| **[MLH] Best Use of Tiger Data** | A time-series database, the natural home for fatigue trends over time | **Stretch**, only after core scope is complete |
| **[MLH] Best Use of Snowflake API** | Only an AI text call in our design; Gemini does it better | **Drop** |
| [MLH] Best Domain Name (GoDaddy) | Ten minutes of effort, for a landing link | Optional, zero risk |
| [MLH] Best Use of Solana | No fit | Drop |
| Best Financial / Environmental | No fit | Drop |
| Best Beginner Hack | Depends on the team's experience level | Not targeted |

---

## 2. Technology decisions (pros vs cons)

### A. Gemini API replaces Snowflake Cortex: **switch**

| | Gemini API | Snowflake Cortex |
| :--- | :--- | :--- |
| Sees the page (screenshots, images, unlabeled buttons) | **Yes**, it reads images | No, text only |
| Matches "open the sports section" to the right numbered target | Excellent, using both the screenshot and the target list | Text only, weaker on messy pages |
| Summaries | Yes, fast "Flash" models | Yes |
| Describes images aloud for the user | **Yes** | No |
| Setup time | One API key from Google AI Studio | Trial account, key-pair JWT auth, region model checks |
| Unique value Snowflake brings | Its strength is data warehousing, which Iris doesn't need | |

**Why it fits better:** an extension knows the page's structure, but many sites have icon-only buttons and images with no labels. Gemini can look at a screenshot together with our numbered targets and answer "target 7 is the search button". That makes the "say what you want" feature reliable on real sites. It also unlocks a new feature: **"What's in this picture?"**, spoken aloud.

**Considered and rejected:** Gemini's "Computer Use" model, which lets an AI drive the browser on its own from screenshots. It's slow (several seconds per step), and it takes control away from the user. Iris's story is that the user stays in charge and confirms every click.

### B. ElevenLabs Agents replaces separate speech-to-text and text-to-speech calls: **switch**

| | ElevenLabs Agents (voice agent with browser tools) | Scribe + TTS wired by hand |
| :--- | :--- | :--- |
| Natural turn-taking: knows when the user finished speaking, can be interrupted | **Built in** | We build it |
| Hands-free start (no push-to-talk button, which these users can't press) | **Yes** | Needs the gaze trigger plus our own silence detection |
| Can act on the page | **Yes, "client tools"**: the agent calls our functions, like click target, scroll, summarize, describe image | We parse intent ourselves |
| Control and debugging | Less control over prompts and timing | Full control |
| Glue code | Much less | More |
| Track story | "A voice agent that operates the browser for people who can't" | "We used speech-to-text and text-to-speech" |

**Decision:** the voice layer is an ElevenLabs Agent running in the side panel. Its client tools are Iris's actions:
- a target proposal that Iris confirms before any future click
- `scroll(direction)`
- `find_target(description)`, which calls Gemini
- `summarize_page()`, which calls Gemini
- `describe_image(n)`, which calls Gemini
- `set_pace(slower)`

Plain text-to-speech stays as a backup for fixed lines (like "Opening...") in case the agent connection fails.

**Rule kept:** every browser click needs Iris confirmation (dwell or long blink),
including ordinary links. Gemini and voice-tool output cannot grant confirmation.
Future voice tools call the existing coordinator and return bounded text/IDs,
never screenshot bytes. ElevenLabs does not need to exist before this MVP.

### C. Tiger Data for fatigue history: **stretch, only if staffed**

**Pros:**
- Fatigue scores, blink rate and click errors over time are exactly the time-series data Tiger Data is built for.
- It's plain SQL (Postgres) and has a free tier.
- Its automatic rollups make a "this week vs last week" caregiver chart cheap to build.
- It adds a prize track.

**Cons:**
- Another service and another screen to build.
- Health data would leave the laptop.

**Rules if built:**
- Strictly opt-in.
- Only minute-level summaries are stored (a fatigue score, not raw heart data or video).
- An anonymous session ID instead of a name.
- The key lives in the Worker.

**Decision:** build it only after the core scope (sections 2A, 2B, 3) is complete. Otherwise the session card stays local.

### D. Things that stay as they are

| Piece | Why it stays |
| :--- | :--- |
| Chrome extension (side panel, coordinator, page helper) | v0.1 capture/understanding implemented for supported visible top-document content; gaze, voice and browser actions remain future work |
| Presage via a local Node.js companion over native messaging | No browser version of Presage exists. Its on-device processing is the privacy story. It supplies the camera-based heart rate, breathing, blink, expression and motion signals behind Iris's fatigue, focus and movement scores. Testing showed it suits slow trends, not clicks (#24). |
| MediaPipe as the gaze (eye and head) tracker | Free and in-browser. Presage has no gaze output, so MediaPipe is the primary aiming source, not a fallback. Its eye closure also drives the long-blink confirm; Presage counts natural blinks for fatigue. |
| Cloudflare Worker holding all keys | Gemini key remains server-side; ElevenLabs/Tiger Data integration remains future work |

### E. Sponsors with no fit

Bloomberg, Diameter Capital, WAGMI-Connect, Canva, NordVPN family and Red Bull have no prize track or API that helps Iris. GitHub Copilot is a development aid, not a product feature.

---

## 3. Feature fixes still needed (independent of technology)

1. **Fast setup:** a 5-dot calibration (not 9) and a long-blink practice bubble, plus a default resting profile so Iris works before a personal baseline exists.
2. **Visible "why":** a side-panel feed of what Iris noticed and what it changed, for example "Blink rate up 40%, slowing clicks". Users always know why Iris changed its pace, and the Presage signals stay visible.
3. **Signal simulation:** a developer-only switch that injects fake gaze, eye closure, blink, vitals and fatigue events through the same provider interface, so every feature can be built and tested without a camera.
