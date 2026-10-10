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

## Run the tests

```sh
npm test
npm run typecheck
```

## Option 1: Playground in a normal tab (no install)

The playground serves the side panel UI on your computer only, so you can try camera and sensor features without installing the extension.

```sh
npm run dev
```

Open http://localhost:5173 in Chrome and allow the camera when asked. The server listens on `127.0.0.1` only, so other devices on your network cannot reach it. Edits reload the page automatically.

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

## Troubleshooting

| Symptom | Fix |
| :--- | :--- |
| Port 5173 already in use | Stop the other process on that port; the dev server will not pick another port. |
| "Camera is off" in the playground | Allow the camera from the camera icon in the address bar, then reload. |
| Camera busy | Close other apps using the webcam (video calls, other tabs). |
