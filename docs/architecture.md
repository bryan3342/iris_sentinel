# Iris: Feasibility and Architecture Review

This review builds on the Iris project specification as the current product design. No code is written here.

---

## 1. Context

Iris is a hands-free web assistant for people with severe motor impairments, built for a weekend hackathon targeting four tracks (Health, Presage, ElevenLabs, Snowflake). The spec is a strong pitch with a sensible demo arc. Three parts of it will not work as written and need changes before Friday night:

**Feasibility verdict per feature**

| Feature | Doable in a weekend? | Verdict |
| :--- | :--- | :--- |
| Zone focus + 1.5s dwell select | Yes | Works if zones are large (3x3 grid max) and there is a 9-point calibration. Webcam gaze error is about 2 to 4 degrees, roughly 100 to 200px on a laptop, so 200px zones are borderline; 150px minimum is too small for gaze, fine for the layout. |
| Long blink (800ms) select | Yes | Easy with eye-openness scores from a face landmark model. Needs a cooldown so dwell and blink do not double-fire. |
| Head-nod scroll (pitch beyond 12 degrees) | Risky | Nodding moves the gaze point and fights dwell, and many target users have limited head control. **Change:** make scroll primary via dwell on top/bottom scroll bands; keep nod as an optional toggle. |
| HR/RR baseline + stress score | Partly | rPPG needs 10 to 30s windows and is slow to react. Talking (which STT requires) shifts breathing rate and adds motion. **Change:** 30s baseline, rolling median, pause scoring while the mic is open, hysteresis + 60s cooldown. Present it as "you might be tired", never a medical claim. |
| Voice query via ElevenLabs STT | Yes | Scribe v2 Realtime supports browser streaming with a single-use token minted by our server. |
| "Navigate the web" | **No, as written** | A web app cannot iframe or drive most real sites (X-Frame-Options, CSP, cross-origin). **Change:** Iris is its own reader. The server searches, fetches and cleans pages, and Iris renders them in its own large-grid reader. A browser extension that drives real sites is a post-hackathon v2. |
| Snowflake summarization | Yes | Cortex REST `inference:complete` with key-pair JWT, server-side only, streams SSE. |
| Expressive TTS playback | Yes | Stream audio chunks; start speaking on the first summary sentence. |
| Search engine | Gap | Spec never names one. **Add:** a search API (Tavily recommended, it returns cleaned page text and saves a fetch step; Brave Search as fallback). |
| Presage for gaze | Gap | Presage SmartSpectra is a vitals product (HR, breathing). Docs list blink/iris landmarks, but web SDK availability is unclear and it is not a gaze-to-screen tracker. **Change:** split sensing (see section 4). |

**Overall:** about 75% doable as specced, about 95% doable with the changes above. Biggest risks are gaze accuracy, Presage web support, and end-to-end latency (estimated 4 to 6s to first spoken word).

**Best application type:** a single Next.js web app (PWA, Chrome desktop target). All computer vision runs in the browser for privacy and speed; a thin server layer (Next.js route handlers) holds every API key and does search, fetch and LLM calls. No separate backend, no database required for the demo.

---

## 2. Technologies / Services

| Layer | Choice | Why / change from spec |
| :--- | :--- | :--- |
| App | Next.js 15 App Router, TypeScript | Spec allows Next or Vite; Next wins because route handlers keep keys server-side. |
| Styling / motion | Tailwind CSS (CSS-variable themes), Framer Motion, Lucide | As specced. Adaptive UI driven by CSS variables (`--font-scale`, `--hit-scale`) rather than swapping class names, so one store update rescales everything. |
| State | Zustand | Sensors update at 30 fps; Zustand selectors avoid re-rendering the whole tree (React Context would). |
| Gaze, blink, head pose | **MediaPipe Face Landmarker** (in-browser, WASM/GPU) | New. 478 landmarks + iris points + blendshapes (eye blink scores) + head transform matrix at 30 fps, fully local. Feeds a small gaze regression fitted during calibration. |
| Vitals (HR, RR) | **Presage SmartSpectra** | Kept for the Presage track. Use its web SDK if available; otherwise a server sidecar that sends short clips to the Presage Physiology REST API every ~5s. Hidden behind a `VitalsProvider` interface. |
| Speech to text | ElevenLabs Scribe v2 Realtime (WebSocket, browser) | Server mints a single-use token (15 min expiry); the API key never reaches the browser. |
| Text to speech | ElevenLabs streaming TTS | Use **Flash v2.5** for short system prompts (lowest latency) and **Multilingual v2** for summaries (most expressive), per spec. |
| Search | Tavily Search API (Brave fallback) | New. Returns ranked results plus extracted page text. |
| Page cleanup | `@mozilla/readability` + `jsdom` | New. Turns raw HTML into readable text for both the reader view and Snowflake. |
| Summarization | Snowflake Cortex REST `/api/v2/cortex/inference:complete`, streaming | As specced. Key-pair JWT auth, server-side only. Model chosen from what the account region offers (e.g. a Claude or Llama model). |
| Optional Snowflake depth | Write anonymized session events (query, latency, stress-triggered yes/no) to a Snowflake table | Strengthens the Snowflake track story ("ingestion") without storing biometrics. |
| Hosting | Vercel (or local for demo) | Route handlers stream fine on the Node runtime. |

**Vendor isolation:** every vendor SDK lives behind a neutral interface (`GazeProvider`, `VitalsProvider`, `SpeechToText`, `TextToSpeech`, `Summarizer`, `SearchProvider`) so a dead SDK at the venue can be swapped for a mock or fallback without touching UI code. This is also what makes the spec's fail-safes cheap.

---

## 3. Data Flow Design

### 3.1 Sensing loop (all in browser, 30 fps)

```
Webcam ─┬─> MediaPipe Face Landmarker ─> landmarks, iris, blink scores, head pose
        │        └─> GazeEstimator (calibrated) ─> smoothed (x,y) ─> ZoneResolver ─> focusedZone
        │                                                 └─> DwellTimer (1.5s) ─┐
        │        blink > 800ms ──────────────────────────────────────────────────┴─> select(zone)
        │        (optional) head pitch ±12° ─> ScrollController
        └─> Presage VitalsProvider (~1 Hz) ─> HR, RR ─> StressEngine
                                                         ├─ baseline (30s, rolling median)
                                                         ├─ score = 0.6·ΔHR + 0.4·ΔRR
                                                         ├─ paused while mic open
                                                         └─ > 0.15 sustained 10s ─> adaptiveMode = on
adaptiveMode ─> CSS vars (font 16→24px, hitbox 1.5x) + TTS prompt "Would you like me to read this page?"
```

### 3.2 Query to spoken summary pipeline

```
select(SearchZone)
 └─> GET /api/stt-token ──> ElevenLabs single-use token
 └─> browser opens Scribe WS, streams mic ──> committed transcript Q
 └─> TTS (Flash): "Searching for Q"                        [masks latency]
 └─> POST /api/search {Q} ──> Tavily ──> top 3 results (+ text)
      └─> UI shows 3 large result zones
select(ResultZone)
 └─> POST /api/page {url} ──> fetch (SSRF-guarded) ──> Readability ──> clean text C
      └─> UI renders C in Reader view (large type, scroll bands)
 └─> POST /api/summarize {C truncated} ──> Snowflake Cortex (SSE stream)
      └─> sentence splitter ──> each sentence ──> POST /api/tts ──> ElevenLabs stream
           └─> browser Web Audio queue plays sentence 1 while 2 is generating
```

**Latency budget (target under 5s to first audio):** STT commit ~0.5s, search ~1s, fetch+clean ~1.5s, Cortex first sentence ~1.5s, TTS first byte ~0.4s. Speaking "Searching for..." immediately makes the wait feel shorter.

### 3.3 Data handling rules
- Webcam frames and landmarks never leave the browser, except Presage clips if the REST fallback is used (vendor processes, we store nothing).
- HR/RR live only in memory; never logged or written to Snowflake.
- All keys (ElevenLabs, Snowflake private key, Tavily, Presage) in server env vars only.
- `/api/page` blocks private/loopback IPs and non-http(s) schemes (SSRF), caps response size, times out at 5s.
- Rate-limit API routes per session to protect paid quotas during the demo.

---

## 4. System Approach

**Principles**
1. **Coarse beats precise.** Everything selectable is a large zone on a fixed grid (3x3 max). No cursor.
2. **One intent at a time.** An input-mode state machine (`idle → focusing → selecting → listening → thinking → speaking`) prevents dwell, blink, nod and voice from colliding. While speaking, gaze only highlights; a "Stop" zone is always available.
3. **Sensors are plugins.** Each sensor publishes normalized events to the store; the UI only reads the store. Mock providers and the Shift+1 / Shift+2 hotkeys plug into the same event bus, so demo fail-safes are not special-cased code.
4. **Stream everything.** LLM tokens and TTS audio are both streamed and stitched at sentence boundaries.

**Screens (all grid-based)**
- **Setup:** camera/mic permission, lighting check (average face brightness from video frames), 9-point gaze calibration, 30s vitals baseline.
- **Home:** Search (big mic zone), Recent, Settings, Help.
- **Results:** 3 result zones + Back + Read top result.
- **Reader:** cleaned article, scroll bands top/bottom, Summarize, Read aloud, Back.
- **Overlay (always):** focus ring with dwell progress arc, mode indicator, vitals chip, Stop.

**Proposed changes to the spec (summary)**
1. Replace "Iris navigates the web" with "Iris searches and reads the web in its own reader"; extension is v2.
2. Gaze/blink/head pose from MediaPipe; Presage for vitals only.
3. Scroll via dwell bands by default; head nod optional.
4. Baseline 30s (not 10s), pause stress while talking, add hysteresis and cooldown.
5. Add a named search API (Tavily) and Readability cleanup.
6. Use Flash TTS for short prompts, Multilingual v2 for summaries.
7. Add SSRF guard, rate limits, and the no-biometric-storage rule.

**Revised phase plan (same weekend shape)**
- **Phase 0 (Fri, 1h): spikes.** Confirm Presage web SDK vs REST; confirm Snowflake account region has a Cortex model + key-pair auth; get Tavily and ElevenLabs keys. Decide fallbacks now.
- **Phase 1 (Fri night, 4h):** Scaffold, grid layout, MediaPipe gaze + calibration + dwell + blink, mock providers + hotkeys.
- **Phase 2 (Sat morning, 5h):** STT token + Scribe, search, page clean, Reader, Cortex streaming, TTS queue.
- **Phase 3 (Sat afternoon, 4h):** Presage vitals, StressEngine, adaptive CSS vars, assistive prompt.
- **Phase 4 (Sat night, 3h):** Cached demo payloads, lighting check, voice tuning, backup video, optional Snowflake event log.

---

## 5. Directory Tree

```
iris_sentinel/
├── README.md                     # setup, env vars, demo hotkeys
├── .env.example                  # ELEVENLABS_API_KEY, SNOWFLAKE_*, TAVILY_API_KEY, PRESAGE_API_KEY
├── next.config.ts
├── tailwind.config.ts            # high-contrast themes, CSS-variable scale tokens
├── public/
│   ├── models/face_landmarker.task
│   └── fallback/                 # cached query results, summaries, audio for offline demo
├── src/
│   ├── app/
│   │   ├── layout.tsx            # providers, overlay, hotkeys
│   │   ├── page.tsx              # Home grid
│   │   ├── setup/page.tsx        # permissions, lighting, calibration, baseline
│   │   ├── results/page.tsx
│   │   ├── reader/page.tsx
│   │   └── api/
│   │       ├── stt-token/route.ts    # ElevenLabs single-use token
│   │       ├── tts/route.ts          # streams ElevenLabs audio
│   │       ├── search/route.ts       # Tavily
│   │       ├── page/route.ts         # SSRF-guarded fetch + Readability
│   │       ├── summarize/route.ts    # Snowflake Cortex SSE passthrough
│   │       └── vitals/route.ts       # Presage REST sidecar (only if no web SDK)
│   ├── components/
│   │   ├── grid/                 # Zone, ZoneGrid, DwellRing, ScrollBand
│   │   ├── overlay/              # FocusIndicator, ModeBadge, VitalsChip, StopZone
│   │   └── setup/                # Calibration, LightingCheck, BaselineMeter
│   ├── sensing/                  # browser-side, provider interfaces + implementations
│   │   ├── types.ts              # GazeProvider, VitalsProvider, events
│   │   ├── gaze/                 # mediapipe.ts, calibration.ts, smoothing.ts, mock.ts
│   │   ├── gestures/             # blink.ts, headPitch.ts, dwell.ts
│   │   └── vitals/               # presage.ts, mock.ts
│   ├── engines/                  # pure logic, unit-testable, no vendor imports
│   │   ├── zoneResolver.ts
│   │   ├── inputModeMachine.ts
│   │   ├── stressEngine.ts       # baseline, score, hysteresis, cooldown
│   │   └── sentenceSplitter.ts
│   ├── voice/                    # SpeechToText, TextToSpeech interfaces + ElevenLabs impls, audio queue
│   ├── server/                   # server-only vendor clients
│   │   ├── snowflake/            # jwt.ts, cortex.ts
│   │   ├── search/               # tavily.ts, brave.ts
│   │   ├── extract/readability.ts
│   │   └── security/             # ssrfGuard.ts, rateLimit.ts
│   ├── store/                    # Zustand slices: sensing, vitals, adaptive, session
│   └── lib/                      # hotkeys.ts (Shift+1/2), fallbackCache.ts, env.ts
└── tests/
    ├── engines/                  # stressEngine, zoneResolver, inputModeMachine
    └── e2e/                      # Playwright run using mock providers
```

---

## Verification (when built)
- Unit tests on `engines/` (stress math, hysteresis, dwell timing, mode transitions).
- Playwright e2e with mock gaze/vitals providers: search, open result, summary audio starts.
- Live check against real APIs with a throwaway session: time-to-first-audio under 5s on venue-like Wi-Fi.
- Manual check: calibration accuracy across 3x3 grid in good and poor lighting; hotkey fail-safes work with camera unplugged.
