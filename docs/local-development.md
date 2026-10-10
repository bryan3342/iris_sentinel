# Local development

Everything below runs on your own computer. Camera video is processed in the browser and never leaves the machine.

## Requirements

- Node.js 20 or newer (includes npm)
- Google Chrome 116 or newer
- A webcam

## Install

From the repository root:

```sh
npm install
```

The first `npm run dev`, `npm run dev:ext` or `npm run build` also prepares eye tracking: it copies the MediaPipe runtime from `node_modules` and downloads the face model (about 4 MB) into `extension/public/mediapipe/`, checking its SHA-256. Later runs reuse the file. This folder is not committed.

## Run the tests

```sh
npm test
npm run typecheck
```

## Option 1: Gaze playground (no install)

```sh
npm run dev
```

This opens http://localhost:5173 as a full-window gaze tracking view. Allow the camera when asked. The server listens on `127.0.0.1` only, so other devices on your network cannot reach it.

1. Put the browser window on the monitor you will look at, ideally the one with the webcam, and make the window as large as the screen.
2. Your camera fills the window with a red ring on each iris. Once your face is steady for about a second, calibration starts by itself: look at each dot until it disappears (9 dots near the screen edges; add `?dots=5` to the address for 5).
3. A red circle then shows where you are looking. It holds steady while your eyes rest on one spot and jumps when you look somewhere new.
4. Click where you are looking to refine the fit. In the product a confirm gesture (breath, long blink or dwell on a numbered target) plays this role; in the playground a click stands in for it. A click far from where the tracker thinks you are looking is ignored.
5. The calibration is saved for this screen in the page's local storage, so a reload tracks right away without the dots. Press **R** to redo the dots, for example after moving to a different screen, and **X** to forget the saved calibration.

Webcam gaze lands within roughly 100 to 200 px of where you look on a laptop screen, which is why Iris snaps to the nearest link or button rather than relying on the exact point. The page must stay visible (Chrome pauses the camera in hidden tabs). Saved calibration data is a few hundred numbers (eye positions, head pose and dot positions), never frames, and it never leaves your computer.

## Option 2: The real extension (load unpacked)

1. Build once, or keep it rebuilding on every save:

   ```sh
   npm run build      # one build
   npm run dev:ext    # rebuild on save
   ```

2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `extension/dist` folder.
3. Click the Iris icon in the toolbar (pin it from the puzzle-piece menu) to open the side panel.
4. The first time, the panel shows **Allow camera**. Click it, allow the camera in the tab that opens, close that tab, then reopen the panel. Chrome does not show camera prompts inside side panels, so the grant happens once in a normal tab.

After a rebuild, click the reload arrow on the Iris card in `chrome://extensions` and reopen the panel.

## What you should see

Once the camera is on, the panel shows **Eye tracking on** and:

- A bright red ring around each open iris and a red dot at its center, drawn on the camera preview and following your eyes frame by frame. Close one eye and its ring disappears; the other eye keeps aiming.
- A short fading red trail behind each iris showing where your eyes just moved. It only draws on screen; nothing is recorded.
- A readout of eye position (look right and `x` rises, look down and `y` rises) and head turn. Eye position shows "not tracked" while your eyes are closed.

## Troubleshooting

| Symptom | Fix |
| :--- | :--- |
| Port 5173 already in use | Stop the other process on that port; the dev server will not pick another port. |
| "Camera is off" in the playground | Allow the camera from the camera icon in the address bar, then reload. |
| Camera busy | Close other apps using the webcam (video calls, other tabs). |
| "Calibration needs your face in view" | Keep your face in view and the tab visible for the whole run, then press R. |
| "Eye tracking failed to start" | Delete `extension/public/mediapipe/` and rerun the command to fetch the runtime and model again. |
