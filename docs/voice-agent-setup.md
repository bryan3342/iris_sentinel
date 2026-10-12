# Voice agent setup

Iris's voice conversation runs on an ElevenLabs agent. The agent hears the user,
decides what to do, and calls Iris's browser tools; Iris runs them in Chrome and
answers in words the agent says back. This page sets up the agent once in the
ElevenLabs dashboard. It takes about 15 minutes.

## What you need

- An ElevenLabs account with Conversational AI (Agents).
- The Iris server set up with Gemini (see [gemini-live-runbook.md](gemini-live-runbook.md)),
  since summaries, descriptions and finding use page understanding.

## 1. Create the agent and choose Gemini

1. In the ElevenLabs dashboard, open **Agents** and create the Iris agent.
2. In the agent's settings, set the **LLM** to a Gemini Flash model from the list.
3. Copy the agent ID (the bare `agent_...` value).

## 2. Connect the agent to Iris

1. In `server/.dev.vars`, set `ENABLE_VOICE_AGENT=true`, `ELEVENLABS_API_KEY`
   (starts with `sk_`) and `ELEVENLABS_AGENT_ID`.
2. From `server/`, give the agent Iris's tools and system prompt:
   `npm run setup:elevenlabs`. It creates or updates every client tool in
   `voice-agent.json`, attaches them to the agent with **Wait for response** on,
   switches on ElevenLabs' **Skip turn** system tool, which lets the agent stay
   silent after a command that worked, and sets the system prompt. For loud
   rooms it adds "Iris" to the speech recognition keywords, so "Hey Iris" is
   recognized over other voices, and keeps **background voice detection** off:
   in a noisy test it kept a nearby speaker's words and dropped the request.
   It also empties the agent's first message, so the agent waits for you, and
   allows Iris to set the first message, which it does only for a check-in when
   you seem tired.
   It leaves the voice, language model and other settings alone, and is safe to
   run again. The tools and prompt live in `server/scripts/voice-agent.json`; a
   test keeps their names in step with the extension. Run it again whenever that
   file changes, such as when Iris gains a new command.
3. Check it: `npm run check:elevenlabs`. It should end with
   `Iris's browser tools attached: true`. If a tool is missing or does not wait
   for a response, the agent can talk but cannot act on the page; if
   `skip_turn` is missing, it talks after every command that worked.
4. Restart the server with `npm run dev`.
5. In the Iris side panel, click **Allow microphone** once, allow page access,
   and just speak: **Listening** under **Talk to Iris** is on by default. Iris
   connects when you start talking and hangs up after a minute of quiet.

Editing the tools or prompt by hand in the dashboard works too, but the next
`npm run setup:elevenlabs` puts them back to `voice-agent.json`.

## 3. Try it

On a long public page, such as a Wikipedia article:

| Say | Expected |
| :--- | :--- |
| (Open the side panel) | After the opening animation, the first time ever, Iris speaks a short intro, also shown as text; after that, "Iris here!". Nothing is expected back, and no microphone or server is needed |
| "Scroll down" | The page moves down a screen, and Iris says nothing: a command that works gets no reply |
| "Go forward" on a tab with no next page | Iris says there is no page that way: it speaks when a command fails |
| Talk while Iris is answering | Iris finishes its answer; it hears you only once it has finished speaking |
| "Go to the bottom" / "go to the top" | The page jumps to that end |
| "Go back" | The previous page opens |
| "Summarize this" while looking at a paragraph | A short spoken summary of that paragraph only |
| "Summarize this" while looking away from the page | Iris says it could not tell what you were looking at; it does not summarize the whole page instead |
| "Summarize the whole page" | A short spoken summary of the visible part of the page |
| "What is this?" while resting your eyes on a link | A spoken description of that link |
| "Find the history section" | Iris names a number and marks it in blue; blink twice to open it |
| "Click number 12" (with **Show numbers on the page** on) | A safe link opens at once, silently; anything that may submit, pay, delete or send is marked in blue and Iris says "Blink twice to confirm." Blink twice to open it, wherever you are looking |

The side panel shows each answer under **Talk to Iris**. Summaries, descriptions
and finding each make one Gemini request, within Iris's limit of ten a minute.

## Iris's fixed lines

The intro and "Iris here!" are not part of a conversation. They are audio files in
the agent's own voice that ship inside the extension (`extension/public/voice`) and
play from a hidden offscreen page, so they need no microphone, server or network.
The text is in `extension/src/sidepanel/agent/voice-lines.json`. After changing a
line or the agent's voice, regenerate the audio from the repository root with
`npm run voice:lines` (it reads the keys in `server/.dev.vars`), then rebuild.
