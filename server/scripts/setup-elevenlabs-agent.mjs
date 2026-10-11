// Local setup only. Makes the ElevenLabs agent match voice-agent.json: creates or updates Iris's
// client tools (waiting for Iris's answer), attaches exactly those to the agent and sets its system
// prompt. Safe to run again; the agent's voice, language model and other settings are left as they are.
import { convai, elevenLabsEnv, missingTools, voiceAgent } from "./elevenlabs.mjs";

const { key, agent } = elevenLabsEnv();

const toolConfig = ({ name, description, parameters }) => ({
  type: "client", name, description,
  expects_response: true, // the agent waits for Iris's answer and says it
  response_timeout_secs: 20, // summaries and finding make one Gemini request
  parameters: { type: "object", properties: parameters, required: Object.keys(parameters) },
});

try {
  const { tools } = await convai(key, "GET", "/tools");
  const existing = new Map(tools.map((t) => [t.tool_config?.name, t.id]));
  const ids = [];
  for (const tool of voiceAgent.tools) {
    const id = existing.get(tool.name);
    const body = { tool_config: toolConfig(tool) };
    if (id) await convai(key, "PATCH", `/tools/${id}`, body);
    ids.push(id ?? (await convai(key, "POST", "/tools", body)).id);
  }
  const { conversation_config: config } = await convai(key, "GET", `/agents/${agent}`);
  const { tools: _inline, ...prompt } = config.agent.prompt; // tools are attached by ID only
  await convai(key, "PATCH", `/agents/${agent}`, { conversation_config: { agent: { prompt: { ...prompt, prompt: voiceAgent.prompt, tool_ids: ids } } } });
  const missing = await missingTools(key, agent);
  if (missing.length) {
    console.error(`The agent still lacks: ${missing.join(", ")}. Check it in the ElevenLabs dashboard.`);
    process.exitCode = 1;
  } else {
    console.log(`Agent ready: ${ids.length} client tools attached and the system prompt set.`);
  }
} catch (error) {
  console.error(`ElevenLabs setup failed: ${error instanceof Error ? error.message : "network or timeout"}.`);
  process.exitCode = 1;
}
