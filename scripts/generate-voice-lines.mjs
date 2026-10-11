// Local, one-time: speaks Iris's fixed lines (extension/src/sidepanel/agent/voice-lines.json) in the
// ElevenLabs agent's own voice and saves them into the extension as extension/public/voice/<name>.mp3,
// so they play from the extension itself with no server, network or microphone. Rerun after changing
// a line or the agent's voice, then commit the audio. Never prints keys or upstream bodies.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { convai, elevenLabsEnv } from "../server/scripts/elevenlabs.mjs";

const { key, agent } = elevenLabsEnv();
const lines = JSON.parse(await readFile(new URL("../extension/src/sidepanel/agent/voice-lines.json", import.meta.url), "utf8"));
const out = new URL("../extension/public/voice/", import.meta.url);

try {
  const { tts } = (await convai(key, "GET", `/agents/${agent}`)).conversation_config;
  if (!tts?.voice_id) throw new Error("the agent has no voice set");
  await mkdir(out, { recursive: true });
  for (const [name, text] of Object.entries(lines)) {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(tts.voice_id)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      // The same voice, model and settings the agent speaks with.
      body: JSON.stringify({ text, model_id: tts.model_id, voice_settings: { stability: tts.stability, similarity_boost: tts.similarity_boost, speed: tts.speed } }),
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`text-to-speech returned HTTP ${response.status}`);
    const audio = Buffer.from(await response.arrayBuffer());
    await writeFile(new URL(`${name}.mp3`, out), audio);
    console.log(`Saved ${name}.mp3 (${Math.round(audio.length / 1024)} KB)`);
  }
} catch (error) {
  console.error(`Voice lines failed: ${error instanceof Error ? error.message : "network or timeout"}.`);
  process.exitCode = 1;
}
