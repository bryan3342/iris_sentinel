# Gaze integration

How the gaze pipeline connects to the rest of the extension so that looking at a
link or button highlights it, and a separate confirm selects it. This document
covers scope and architecture. The overall design is in
[architecture.md](architecture.md).

## 1. Current state

| Piece | Where | Status |
| :--- | :--- | :--- |
| MediaPipe gaze provider | `extension/src/providers/mediapipe/` | Built. Runs in the side panel and the playground. |
| Simulated gaze provider | `extension/src/providers/simulated/` | Built. Scripted looks for tests, mouse-driven looks in the playground (`?sim`). |
| Calibration, confirm refinement, smoothing | `packages/core/` | Built and unit tested. |
| Dot calibration and gaze circle | `extension/src/sidepanel/setup/`, `gaze-dot.ts` | Built, used only by the playground. |
| Page scanner (numbered links and buttons with positions) | `extension/src/page-understanding/page-helper.ts` | Built for page understanding. Runs once per Gemini request. |
| Page change counter (revision) | same scanner | Built. Increments on scroll, resize and DOM changes. |
| Gemini target matching | `extension/src/page-understanding/`, `server/` | Built. Returns a target number or none. Never clicks. |

**The gap.** In the extension, gaze stops at the side panel readout. Nothing
calibrates there, no gaze point reaches the page, and the page shows no numbers
or highlight. The page scanner already produces the numbered target list that
gaze needs, with one catch: it marks a page as blocked when it contains an
iframe, video, custom element, running animation or zoom, and page
understanding refuses blocked pages. Those rules protect screenshots sent to
Gemini. Gaze sends nothing anywhere, so it needs a target-only scan that keeps
working on those pages (step 4).

Nothing in the extension clicks today. Step 8 adds the first, and only, place
that does.

## 2. Target design

The numbered target list is the shared vocabulary. Gaze and Gemini both resolve
to a target number, both use the same highlight, and both go through the same
confirm gate.

```
Camera ─> MediaPipe or simulator ─> calibration ─> smoothing ─> gaze point
                                                                    │
Page scanner ─> numbered targets with positions ───────────> snap to nearest
                                                                    │
Typed or spoken request ─> Gemini ─> target number ──┐              │
                                                     ▼              ▼
                                           aimed target (one at a time)
                                                     │
                                       highlight on the page (no click)
                                                     │
                                       confirm (dwell or long blink)
                                                     │
                                       select target; risky actions confirm twice
```

**Where snapping runs.** In the side panel, next to the gaze provider. The side
panel already requests page snapshots for page understanding, so it can hold the
current target list, snap each smoothed gaze point locally, and message the page
only when the aimed target changes. This keeps the message rate low (a few per
second at most instead of about 30) and keeps raw gaze points inside the
extension's own pages.

**Coordinates.** Target positions are CSS pixels in the browsing tab's visible
viewport. Calibration outputs a fraction of whatever area the dots were shown
in. When the dots are drawn over the browsing tab's viewport (step 5), gaze
fractions multiplied by the snapshot's viewport size are in the same frame as
the targets, with no screen-to-window conversion. Anything that turns a gaze
fraction into pixels, including the head-movement correction inside
`applyCalibration`, must use the snapshot's viewport, not the side panel's own
window size.

**The overlay must not disturb the scanner.** The scanner counts DOM changes,
animations and transitions as page changes, and treats custom elements as
unreadable. An overlay built naively would bump the change counter every time it
draws (clearing the highlight it just drew) and could mark the page as blocked.
So the overlay is a plain `div` host with a closed shadow root, mounted once and
updated only inside that root (a document-wide mutation observer does not see
inside shadow roots), with no CSS animations or transitions and
`pointer-events: none` (so `elementFromPoint`, which the scanner uses to check
that a target is not covered, looks straight through it). The scanner also
skips the host element.

**Page access.** Page understanding relies on `activeTab`, which Chrome grants
when the user invokes the extension and revokes when they navigate to another
site. Someone browsing hands-free cannot click the toolbar again after every
link, so continuous gaze needs host access granted once (the manifest already
lists optional host permissions) and the helper and overlay injected again after
each navigation.

## 3. Steps

Each step is one small, single-concern PR.

### Step 1: Snap a gaze point to a target

- **What.** A pure function in `packages/core/` that takes a point and the
  numbered targets and returns the nearest target ID, or none when nothing is
  within a maximum distance. Distance is measured to the target's rectangle, not
  its center, so large targets are easy to hit. A small hysteresis keeps the aim
  from flickering between two neighbors.
- **Why first.** No dependencies, no browser APIs, and it fixes the rule both
  input paths will share.
- **Done when.** Unit tests cover inside, near, far, overlapping and
  neighboring targets, plus a simulated-provider run that settles on the
  intended target.

### Step 2: Show numbers and a highlight on the page

- **What.** A page overlay that draws each target's number and can highlight
  one target by ID. It draws only; it never clicks, scrolls or focuses page
  elements. The overlay ignores pointer events so it cannot intercept the page.
- **Why.** Users need to see what Iris will act on. Gemini's existing
  "recommended target N" result can use it immediately.
- **How.** Built as described under "The overlay must not disturb the scanner."
- **Done when.** Asking Gemini to find a target highlights it on the page, the
  highlight clears when the page changes, and drawing the overlay does not move
  the page's change counter.

### Step 3: Keep page access across navigation

- **What.** A one-time host access request from the side panel, and the page
  helper and overlay injected again after each navigation in the browsing tab.
- **Done when.** After granting access once, following a link to another site
  keeps the overlay working with no toolbar click.

### Step 4: Keep the target list fresh

- **What.** Gemini scans once per request; gaze needs the list continuously.
  The page reports when its change counter moves (throttled to a few times a
  second), and the side panel requests a new snapshot. Gaze uses a target-only
  scan that ignores the screenshot blocking rules; page understanding keeps
  them. Target IDs are only valid for the revision they came from; an aimed
  target from an older revision is dropped.
- **Done when.** Scrolling or a page update refreshes the numbers and the aimed
  target without a reload, including on a page with an iframe or a video.

### Step 5: Wire gaze to the highlight

- **What.** The side panel snaps each smoothed gaze point (step 1) against the
  current list (step 4) and sends the aimed target to the overlay (step 2) when
  it changes. While the eyes are closed or the face is lost, the aim holds. The
  calibrate-then-smooth code in `gaze-dot.ts` moves into a shared piece that
  takes a viewport, so the playground and the side panel use the same path.
- **Done when.** With the simulated provider driven by the mouse, moving over a
  real website highlights the nearest numbered target. With MediaPipe this also
  works, but accuracy depends on step 6.

### Step 6: Calibrate on the page

- **What.** Run the existing dot calibration over the browsing tab instead of
  the playground: the overlay draws the dots, the side panel collects eye
  samples, and the saved calibration loads automatically for returning users.
  Confirms during use keep refining the fit, as in the playground.
- **Design decision to settle.** Saved calibrations are keyed by screen size and
  scaling, but the tab's viewport can change size (window resize, side panel
  width). Recommended: store each dot's position on the screen (its viewport
  position plus the window's position on the screen), so the existing screen key
  stays valid and a viewport change becomes a coordinate change. The window
  offset is only approximate, a few pixels against webcam error of about a
  hundred, and confirm refinement absorbs it. Fallback: rely on confirm
  refinement after small changes and ask for the dots after large ones. Settled
  on a real machine in this step.
- **Done when.** A real user calibrates on a website, and the highlight follows
  their eyes to the targets they look at.

### Step 7: One confirm event

- **What.** A neutral confirm event in `packages/core/` that every confirm
  method produces: dwell (from gaze, built here, with a configurable time in the
  500 to 1000 ms range common for gaze dwell), long blink (later, from the
  per-eye closure MediaPipe already measures, which `GazeSample` does not carry
  yet), and a test stand-in. Presage never confirms; see `architecture.md`.
- **Done when.** Dwell and the stand-in produce the same event, and a dwell
  only fires on a target that stayed aimed for the whole dwell.

### Step 8: Select the confirmed target

- **What.** The first click in Iris, run by the page helper. Before clicking it
  checks that the document, the revision and the element still match what was
  aimed; otherwise it drops the confirm. The scanner marks risky targets (submit
  buttons, controls inside forms, labels such as pay, buy, delete or send);
  anything it cannot classify counts as risky. Risky targets need a second
  explicit confirm, even when Gemini or the voice agent proposed them.
- **Done when.** Dwelling on a link opens it, a risky control asks for a second
  confirm, a page change between aim and confirm cancels the click, and
  swapping dwell for the test stand-in changes nothing downstream.

**Dependencies.** Steps 1 and 2 are independent. Step 3 needs 2, step 4 builds
on the scanner, step 5 needs 1 to 4, step 6 needs 2 and 5, step 7 needs 5, and
step 8 needs 7.

## 4. Guardrails

- **Privacy.** No video, frames or face landmarks leave the side panel. Gaze
  points stay inside the extension's own pages; the page receives only "target N
  is aimed." Nothing from the gaze path is sent to Gemini or any server.
  Calibration stores a few hundred numbers on the device, never frames.
- **Click safety.** Looking only aims. Selection always needs a confirm, and the
  overlay itself has no way to click.
- **Vendor isolation.** Everything after the gaze provider sees only
  `GazeProvider` samples, so MediaPipe and the simulator are interchangeable.
  Snapping and dwell live in `packages/core/`, which imports no vendor SDK.
- **Tests.** Each step is tested with the simulated provider; core logic gets
  direct unit tests.

## 5. Open question outside these steps

**Camera sharing with Presage.** The design assumes the side panel and the
Presage companion can open the webcam at the same time. This was verified on the
demo laptop and is still checked on each other target machine. If it fails, the companion owns the camera and forwards
downscaled frames, and the MediaPipe provider gains a second frame source behind
the same `GazeProvider` interface. None of the steps above depend on the answer.
