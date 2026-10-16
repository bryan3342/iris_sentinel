# Iris

## Description

A Chrome accessibility prototype for hands-free browsing. The extension combines webcam gaze tracking, double-blink confirmation, finger pointing, head-controlled scrolling, optional voice tools, and optional body-signal sensing.

## Dependencies

- Chrome 116 or newer, a webcam, and camera permission. Voice interaction also needs a microphone.
- Node.js and npm. Node 22.12+ within the Node 22 release line satisfies the checked-in Vite and Vitest engine ranges; the server requires Node 22+.
- Internet access on the first extension build to download MediaPipe models.
- Gemini and ElevenLabs credentials for the optional server-backed features.
- For Presage: Apple Silicon macOS, Apple's command-line tools, a Presage key, and the companion dependencies.

## Technologies

TypeScript, Chrome Manifest V3, MediaPipe Tasks Vision, Vite, Vitest, ElevenLabs, Gemini, Cloudflare Workers, and a Node.js native-messaging companion using the Presage SmartSpectra SDK.

## Setup

Build the extension from the root:

```bash
git clone https://github.com/bryan3342/iris_sentinel.git
cd iris_sentinel
npm ci
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `extension/dist`. Open Iris's side panel and complete the camera-permission and calibration steps.

For page understanding or voice, install the separate server package:

```bash
cd server
npm ci
cp .dev.vars.example .dev.vars
```

Fill in your own keys and agent ID. Follow [server setup](server/README.md) and the [Gemini runbook](docs/gemini-live-runbook.md) before enabling page-content processing. Voice requires `ENABLE_VOICE_AGENT=true`. The local Worker uses `http://127.0.0.1:8787`.

The Presage companion is optional and has a separate installation. Follow [local development](docs/local-development.md) to store the key in macOS Keychain, install `companion/`, and register the native host.

## Features

- Gaze calibration and aiming at page targets, with double-blink selection.
- Finger tracking with pinch input and head-tilt scrolling.
- Numbered page targets and voice navigation tools.
- Gemini-backed viewport summaries, target matching, and image descriptions on request.
- Optional Presage readings, fatigue indicators, and changes to aiming tolerance.
- A standalone gaze playground, tests, and a static landing page.

Actions classified as submitting, paying, deleting, or sending require double-blink confirmation. Ordinary voice-requested links can open directly. Body-signal readings are estimates. The database scripts in `server/db/` are separate from the database-free local Worker setup.

## Commands to run

| Directory | Command | Purpose |
| --- | --- | --- |
| Root | `npm run dev` | Gaze playground at `http://localhost:5173`. |
| Root | `npm run dev:ext` | Rebuild the extension on changes. |
| Root | `npm run build` | Build `extension/dist`. |
| Root | `npm test` | Run Vitest tests. |
| Root | `npm run typecheck` | Check TypeScript. |
| `server/` | `npm run dev` | Run the local Worker. |
| `server/` | `npm test` | Run server tests. |
| `server/` | `npm run typecheck` | Check server TypeScript. |
| `companion/` | `npm run install:host` | Build and register the macOS companion. |
| `companion/` | `npm run uninstall:host` | Remove the native-host registration. |

The server's `check:gemini` and `check:elevenlabs` scripts call live providers. The companion's `check:presage` script uses the camera and Presage credits.

## Contributors

- [Bryan Mejia (@bryan3342)](https://github.com/bryan3342)
- Sharlyn Barreto, also recorded as Sharlyn8 in Git history.
- [Giancarlo Forero (@gianca2020)](https://github.com/gianca2020)
- [Nia (@NiaBiaCodes)](https://github.com/NiaBiaCodes)

Human contributor credit is based on the repository's commit history.

## Further documentation

- [Architecture](docs/architecture.md)
- [Local development](docs/local-development.md)
- [Voice-agent setup](docs/voice-agent-setup.md)
- [Page-understanding protocol](docs/page-understanding-protocol.md)
