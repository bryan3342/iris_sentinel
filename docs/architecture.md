# Iris: Architecture

Iris is a Chrome extension that lets people with severe motor impairments browse real websites hands-free. Users aim with their eyes (or head), confirm with a breath hold, a long blink or a dwell, and speak requests to a voice agent. Iris watches for fatigue through the camera and adapts its pace before the user gives up.

Track and technology choices behind this design are in [tracks.md](tracks.md).

---

## 1. Context

**Problem.** People with ALS, spinal cord injuries or cerebral palsy often cannot use a mouse or keyboard. Existing eye-control tools move a cursor pixel by pixel, which is jittery on webcams, and they click whatever the user happens to look at (the "Midas touch" problem). Eye control is also tiring, and accuracy drops as the session goes on.

**What Iris does differently.**

| Idea | How |
| :--- | :--- |
| Aim at real targets, not pixels | The extension reads the page, numbers every link and button, and snaps focus to the nearest one. |
| Separate aiming from clicking | Eyes aim. A breath hold (a webcam version of the sip-and-puff switches quadriplegic users already rely on), a long blink or a dwell confirms. |
| Say what you want | A voice agent maps "open the history section" to the right target, summarizes pages and describes images. |
| Adapt to fatigue | Body signals (blink rate, heart rate variability, breathing) plus behavior (more "go back" actions, shakier aim) drive a fatigue score. Iris slows down, enlarges targets, then offers to read aloud. |
| Private by default | All camera processing happens on the laptop. No video ever leaves the machine. |

**Scope boundaries.**
- Works on normal websites. Chrome's own pages and the address bar are out of reach for extensions; voice "go to <site>" covers navigation.
- Fatigue is presented as "you might be tired", never as a medical reading.
- Desktop Chrome only.
- The companion runs where the Presage Node.js SDK does: Apple Silicon Macs, Windows x64 and Linux (glibc 2.35+). Intel Macs are not supported.

---

## 2. Technologies / Services

| Layer | Choice | Role |
| :--- | :--- | :--- |
| Client | Chrome extension, Manifest V3, TypeScript | Side panel (UI, voice agent, gaze tracking), background coordinator, page helper injected into each tab |
| Vitals and face sensing | **Presage SmartSpectra** (Node.js SDK) in a local companion | Live breathing waveform, blinks, talking detection, heart rate, heart rate variability. Runs on-device. Presage has no gaze output and no fatigue score. |
| Companion link | Chrome native messaging | Chrome starts the companion and only Iris's extension can reach it. No open network port. |
| Gaze (where the user looks) | MediaPipe Face Landmarker (in the side panel) | Primary aiming source. Eye and head landmarks are mapped to a screen point through the 5-dot calibration. The WebAssembly runtime and model are bundled with the extension. |
| Voice | **ElevenLabs Agents** with client tools | Hands-free conversation with turn-taking; calls Iris actions as tools |
| Fixed voice lines | ElevenLabs text-to-speech | Backup for short system lines if the agent connection fails |
| Page understanding | **Gemini API** (Flash models, image input) | Matches spoken requests to numbered targets using a screenshot plus the target list, summarizes pages, describes images |
| API gateway | Cloudflare Worker | Holds every API key; mints the ElevenLabs agent session; proxies Gemini |
| Fatigue history (optional) | Tiger Data (managed Postgres with time-series) | Opt-in minute-level fatigue summaries for a caregiver trends view |
| Shared logic | Plain TypeScript package | Target snapping, input modes, fatigue score, calibration fit. No vendor imports. |

**Vendor isolation.** Every vendor sits behind a neutral interface so it can be swapped without touching callers:

| Interface | Implementations |
| :--- | :--- |
| `GazeProvider` (where the user looks) | MediaPipe, simulated |
| `FaceProvider` (blinks, talking) | Presage companion, simulated |
| `VitalsProvider` (breathing wave, HR, HRV) | Presage companion, simulated |
| `VoiceAgent` | ElevenLabs Agents |
| `PageUnderstanding` | Gemini |
| `SessionStore` | Local only, Tiger Data |

---

## 3. Data Flow Design

### 3.1 Sensing loop (on the laptop)

```
Webcam ─> Iris Companion (Node.js, Presage SDK)
            ├─ breathing waveform ─> BreathHoldDetector ──────────┐
            ├─ blink frames ───────> BlinkSegmenter ─> blink events (with duration)
            │                          └─ LongBlinkDetector ──────┤ confirm events
            ├─ talking on/off ─────> pauses confirms while talking│
            └─ HR, HRV, blink events (for fatigue)                │
                 │ native messaging (small JSON events, no video) │
                 ▼                                                ▼
        Background coordinator ── input mode state machine ── click(target)
          ├─ FatigueEngine (packages/core)                        │
          ▲                                                       ▼
          │ gaze points (screen coordinates)
Webcam ─> Side panel: MediaPipe Face Landmarker ─> calibration fit
                 │
                 ▼
        Page helper: numbered overlay, snap aim to nearest target, click, scroll,
                     enlarge text and targets when fatigue rises
```

**Who owns what.**
- **Where the user looks:** MediaPipe only. The calibration fit and target snapping live in `packages/core/`.
- **Blinks:** Presage only. MediaPipe's blink detection is not used, so the two can never disagree. Presage reports blinking as a per-frame flag; the companion groups those frames into single blink events with a duration. Long blinks become confirm events; every blink event also feeds the fatigue score, which leaves out the long blinks used as confirms.
- **Fatigue:** computed by Iris in the background coordinator, because it combines companion signals with behavior that only the extension sees.

**Camera sharing.** The companion and the side panel each open the webcam. Both must run at once; this is verified on every target machine before building on it. If it fails, the companion owns the camera, feeds Presage through its custom input path, and forwards downscaled frames to the side panel for MediaPipe over native messaging (each message to the extension is capped at 1 MB).

**Fatigue score.** Combines slow body signals (blink rate up, heart rate variability down, breathing rate) with behavior (back-after-click rate, aim steadiness, time to click). It is computed against the user's own resting baseline, uses hysteresis so it does not flicker, and is paused while the user is talking.

| Fatigue level | Iris response |
| :--- | :--- |
| Fresh | Normal confirm timing and target size |
| Tiring | Longer confirm timing, larger targets |
| Fatigued | Agent offers to read the page aloud and take requests by voice |
| Sustained strain | Suggests a break; pauses gaze confirms until the user looks back |

### 3.2 Voice request flow

```
User speaks ─> ElevenLabs Agent (side panel, signed session from Worker)
                 └─ calls client tool, for example find_target("history section")
                      └─ coordinator asks page helper for screenshot + numbered target list
                      └─ Worker /gemini ─> Gemini ─> "target 12"
                 └─ highlights target 12, asks for confirm
User confirms (breath / blink / dwell) ─> page helper clicks target 12
Agent: "Opening History."
```

**Client tools exposed to the agent:** `click_target(n)`, `scroll(direction)`, `find_target(description)`, `summarize_page()`, `describe_image(n)`, `set_pace(slower|faster)`.

**Safety rule.** Anything that submits, pays or deletes always needs an explicit confirm, even when the agent proposes it.

### 3.3 Data handling rules

- Video and face landmarks never leave the laptop. Presage computes on-device and only contacts its backend to validate the API key. The companion turns Presage telemetry off (`enableTelemetry: false`) and does not use Presage LLM Insights, which would send measurements off the laptop.
- Heart, breathing and blink data live in memory only.
- If Tiger Data is enabled: strictly opt-in, minute-level fatigue summaries only, anonymous session ID, write key held by the Worker.
- All API keys live in Worker secrets. The extension holds none. The one exception is the Presage key, which the SDK needs on-device: the companion reads it from the operating system keychain at startup, holds it in memory only, and never writes it to code, logs or config files.
- Page screenshots sent to Gemini are taken only on a user request and are not stored.
- The Worker rate-limits each session to protect paid quotas.

---

## 4. System Approach

**Principles**
1. **Targets, not pixels.** Aim always snaps to a real, numbered page element.
2. **Aim and confirm are separate.** No click happens from looking alone.
3. **One intent at a time.** An input mode state machine (`idle → aiming → confirming → listening → acting → speaking`) keeps eyes, breath, blinks and voice from colliding.
4. **Sensors are plugins.** Every sensor publishes normalized events through its interface; a simulated provider plugs in the same way for development without a camera.
5. **Show the why.** A side-panel feed tells the user what Iris noticed and what it changed ("Blink rate up 40%, slowing clicks").

**Input options (user chooses)**

| To... | Default | Alternatives |
| :--- | :--- | :--- |
| Aim | Eyes | Head pointing |
| Confirm | Breath hold (about 2s) | Long blink, dwell |
| Scroll | Look at the top or bottom edge band | Voice |
| Navigate by intent | Voice request | Aim and confirm |
| Read | Voice "read this" | Read zone |

**Setup flow**
1. Camera and microphone permission, requested once from an extension tab page (a side panel may not show the permission prompt); the side panel then reuses the grant.
2. Lighting check.
3. 5-dot calibration inside the page.
4. Breath-hold practice.
5. A default resting profile is used until a personal baseline has built up.

---

## 5. Directory Tree

```
iris_sentinel/
├── docs/
│   ├── architecture.md          # this file
│   └── tracks.md                # track and technology analysis
├── extension/                   # Chrome extension (Manifest V3)
│   └── src/
│       ├── background/          # coordinator, input mode state, native messaging link
│       ├── sidepanel/
│       │   ├── agent/           # ElevenLabs agent session and client tool definitions
│       │   └── setup/           # permissions, lighting, calibration, breath practice
│       ├── content/             # target finder, numbered overlay, click/scroll, enlarge, screenshot
│       └── providers/           # MediaPipe gaze, simulated sensors
├── companion/                   # Node.js helper running Presage
│   ├── src/
│   │   ├── presage/             # SDK session behind FaceProvider / VitalsProvider
│   │   └── detectors/           # breath hold, blink segmenter, long blink, talking gate
│   └── install/                 # registers the native messaging host (macOS, Windows)
├── server/                      # Cloudflare Worker, holds all keys
│   └── src/
│       └── routes/
│           ├── agent-token/     # signed ElevenLabs agent session
│           ├── gemini/          # find target, summarize, describe image
│           └── tts/             # fixed voice lines
├── packages/
│   ├── core/                    # target snapping, input modes, fatigue score, calibration fit
│   └── protocol/                # message types shared by companion, extension, server
└── tests/
    ├── core/                    # unit tests for packages/core
    └── e2e/                     # end-to-end flows with simulated sensors
```

Optional Tiger Data support adds `server/src/routes/sessions/` and a trends view in the side panel.
