# Repository rules for automated review

Iris is a Chrome extension for hands-free browsing by people with severe motor
impairments. Read `docs/architecture.md` for the design and `docs/tracks.md` for the
technology choices.

## Your role here

- **PR agent** (`claude-pr-review.yml`, runs when a PR opens): analyze the PR, fix
  bugs and code smells in the changed code, commit the fixes to the PR branch only,
  post one summary comment, then mark the PR ready for review. A human merges.
- **On request** (`@claude` in an issue or comment): answer and comment only. Do not
  commit or edit files.
- **Never** merge, approve, push to `main`, or edit `.github/`.

## PR flow

1. Open every PR as a **draft**.
2. The PR agent picks it up, pushes fixes, comments, and marks it ready.
3. A human reviews and merges. Nothing merges automatically.

## Review priorities (in order)

1. **Privacy.** Video and face landmarks never leave the laptop. Heart, breathing and
   blink data stay in memory. Page screenshots go to Gemini only on a user request
   and are never stored. Flag any code that sends, logs or persists these.
2. **Secrets.** All API keys live in Worker secrets (`server/`). The extension and
   companion hold none. No keys in code, logs or test fixtures.
3. **Vendor isolation.** Vendor SDKs (Presage, ElevenLabs, Gemini, MediaPipe, Tiger
   Data) are used only behind their neutral interfaces (`FaceProvider`,
   `VitalsProvider`, `VoiceAgent`, `PageUnderstanding`, `SessionStore`).
   `packages/core/` must not import any vendor SDK.
4. **Click safety.** Nothing clicks from gaze alone. Anything that submits, pays or
   deletes needs an explicit confirm (breath, blink or dwell), even when the voice
   agent proposes it.
5. **Correctness and tests.** Logic in `packages/core/` needs direct unit tests.
   Prefer simulated sensor providers over hand-written mocks.
6. **Docs.** A change to architecture, data flow or a vendor choice updates
   `docs/architecture.md` in the same PR.

## Conventions to check

- Issue and PR titles are `label:short description` (no space after the colon),
  e.g. `extension:numbered target overlay`.
- Each issue and PR carries **exactly one** label, matching the title prefix.
  Labels: `extension`, `companion`, `server`, `core`, `ci`, `documentation`,
  `spike`, `bug`, `enhancement`.
- One concern per PR.
- No em dashes in docs or user-facing text.
- Commit messages and PR bodies contain no AI attribution lines (no
  `Co-Authored-By` trailers, session links or "Generated with" footers).
