# ElevenLabs conversation milestone

Basic conversation is implemented: signed-session minting, microphone access,
hands-free listening (connects when the user speaks, hangs up after a minute of
quiet), listening/speaking status, and cleanup on panel closure.
Browser tools are connected: run `npm run setup:elevenlabs` in `server/` to give
the agent its tools and prompt (see [voice-agent-setup.md](voice-agent-setup.md)).
User-talking signals are not connected yet.

## Verify locally

1. In ignored `server/.dev.vars`, set `ENABLE_VOICE_AGENT=true`, the bare
   `ELEVENLABS_AGENT_ID=agent_...`, and an `ELEVENLABS_API_KEY=sk_...`.
   Use a private agent requiring authentication. Never commit these values.
2. Run `npm run check:elevenlabs` in `server/` to check credentials without
   opening a microphone conversation. Then run `npm run dev` there.
3. Run `npm run build` from the root and reload the unpacked `extension/dist`
   extension in Chrome. Open its side panel and grant microphone permission.
4. With **Listening** on, speak, and verify Iris connects and replies.
   This sends audio to ElevenLabs and uses conversation quota.
5. Turn Listening off during a reply and check that playback and microphone use end.
   Turn it on again, then close the side panel and check that microphone use ends again.
6. Turn Listening off while connecting; a late session must close. Deny microphone access or
   stop the local server and check that the status shows a recoverable error.

Automated checks: root `npm test`, `npm run typecheck`, `npm run build`;
server `npm test` and `npm run typecheck`. Audio processors must appear as local
files in `extension/dist/assets`, since the extension blocks data/blob scripts.
Automated checks do not prove live audio or agent dashboard configuration.

## Small PR sequence

Count additions plus deletions, including tests, docs and generated lockfiles.
Keep each PR at or below 300 lines and check it before the next feature.

1. Validate ElevenLabs credentials and add the signed-URL setup check.
2. Pin the browser SDK and its lockfile changes.
3. Connect basic conversation, lifecycle tests, and this runbook.
4. Add genuine user-talking signals; agent listening mode alone is insufficient.
5. Add `summarize_page`, then `describe_image`, using existing page-understanding
   checks and returning text without screenshots.
6. Add `find_target` and target proposals through Iris's confirmation gate;
   the agent must never click directly. Add scrolling and pace controls later.
