# Local development

Everything below runs on your own computer. Camera video is processed in the browser and never leaves the machine.

## Requirements

- Node.js 20 or newer (includes npm)
- Google Chrome 116 or newer
- A webcam (optional for the playground, see [Without a camera](#without-a-camera))

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
4. Click where you are looking to refine the fit. In the product a confirm gesture (a dwell or long blink on a numbered target) plays this role; in the playground a click stands in for it. A click far from where the tracker thinks you are looking is ignored.
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

To aim without calibrating, turn on **Point with the mouse** in the panel. A red ring, the gaze cursor, follows the mouse over the page, and the nearest numbered link or button is outlined; resting on it for a second selects it. Anything that may submit, pay, delete or send asks for a second confirm: move away, then rest on it again within six seconds. To aim with your eyes, click **Calibrate on this page** and look at each of the 9 dots until it moves (about 16 seconds); aiming starts when it finishes, and the red gaze cursor follows your eyes over the page. The calibration is saved on this computer, so next time **Aim with my eyes** works right away.

**Fixed extension ID.** Iris always loads as `bohipliohnmknfglnkhglngbmpiahdcn`, on every computer, because `manifest.json` carries a public `key` (not a secret). The companion only answers this ID. Use it wherever a setup step asks for the extension ID, for example `EXTENSION_ORIGIN=chrome-extension://bohipliohnmknfglnkhglngbmpiahdcn` in `server/.dev.vars`. If you loaded Iris before the ID was fixed, Chrome sees this as a new extension: remove the old Iris card, load `extension/dist` again, and allow the camera once more.

## Run the companion (macOS)

The companion is the small Node.js program that runs Presage on this computer, beside Chrome. Chrome starts it when Iris connects; it opens no network port. It needs macOS (Apple Silicon for Presage) and Node 20 or newer.

1. Store your Presage API key in the Keychain once. With `-w` last, the tool asks for the key, so it never lands in your shell history:

   ```sh
   security add-generic-password -U -s iris-presage -a iris -w
   ```

2. Build the companion and register it with Chrome:

   ```sh
   cd companion
   npm ci
   npm run install:host
   ```

   This copies the companion to `~/Library/Application Support/Iris/companion/`, out of the repository, which macOS may protect if it sits in `~/Desktop`. It writes a launcher that calls Node by its full path, since Chrome starts programs with almost no `PATH`, and registers it with Chrome as `com.iris.companion`, which only the Iris extension ID may start. Run `npm run install:host` again after pulling companion changes.

3. Open the Iris side panel. It connects to the companion right away and shows **Body signals: companion connected**. Closing the panel ends the companion.

4. To check Presage on its own, without Chrome, run `npm run check:presage` in `companion/`. It measures for 60 seconds (pass another number of seconds after `--`), shows camera hints, and reports which signals arrived, never the readings themselves. It turns on the camera and uses about a minute of Presage credit. Pulse settles after about 12 seconds, breathing after about 30 and HRV after about 60.

5. To remove it, run `npm run uninstall:host` in `companion/`.

## What you should see

Once the camera is on, the panel shows **Eye tracking on** and:

- A bright red ring around each open iris and a red dot at its center, drawn on the camera preview and following your eyes frame by frame. Blinking does not disturb it; close one eye for longer than a blink and its ring disappears while the other eye keeps aiming.
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
| "Specified native messaging host not found" | The companion is not registered: run `npm run install:host` in `companion/`. |
