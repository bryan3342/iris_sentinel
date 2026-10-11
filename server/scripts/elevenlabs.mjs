// Shared by the local ElevenLabs scripts. Never prints keys, signed URLs or upstream bodies.
import { readFile } from "node:fs/promises";

/** The API key and agent ID from server/.dev.vars, or exits with a hint when either is malformed. */
export function elevenLabsEnv() {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  const agent = process.env.ELEVENLABS_AGENT_ID?.trim();
  if (!key || key.endsWith("replace_with_your_key")) {
    console.error("Set ELEVENLABS_API_KEY in server/.dev.vars before running this script.");
    process.exit(1);
  }
  if (!/^sk_[A-Za-z0-9]{20,}$/.test(key)) {
    console.error("ELEVENLABS_API_KEY must be an API key starting with sk_, not an API key ID.");
    console.error("Keys are shown only when created or rotated in the ElevenLabs dashboard.");
    process.exit(1);
  }
  if (!agent || !/^agent_[A-Za-z0-9_-]{1,100}$/.test(agent)) {
    console.error("ELEVENLABS_AGENT_ID must be a bare agent ID, such as agent_0123abc.");
    console.error("Remove any query suffix copied from a dashboard URL, such as ?branchId=...");
    process.exit(1);
  }
  return { key, agent };
}

/** The agent's system prompt and Iris's client tools, as the extension expects them (see voice-agent.json). */
export const voiceAgent = JSON.parse(await readFile(new URL("./voice-agent.json", import.meta.url), "utf8"));

/** Calls the ElevenLabs agents API; throws an error naming only the method, resource and status. */
export async function convai(key, method, path, body) {
  const response = await fetch(`https://api.elevenlabs.io/v1/convai${path}`, {
    method,
    headers: { "xi-api-key": key, ...(body ? { "content-type": "application/json" } : {}) },
    body: body && JSON.stringify(body),
    redirect: "manual", // a redirect is refused, never followed
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${method} ${path.split("/")[1]} returned HTTP ${response.status}`);
  return response.json();
}

/**
 * Names of Iris's tools the agent lacks: client tools not attached as tools that wait for Iris's
 * answer, and system tools (such as skip_turn) not switched on.
 */
export async function missingTools(key, agent) {
  const { conversation_config: config } = await convai(key, "GET", `/agents/${agent}`);
  const attached = new Set(config.agent.prompt.tool_ids ?? []);
  const switchedOn = config.agent.prompt.built_in_tools ?? {};
  const { tools } = await convai(key, "GET", "/tools");
  const ready = new Set(tools.filter((t) => attached.has(t.id) && t.tool_config?.type === "client" && t.tool_config.expects_response)
    .map((t) => t.tool_config.name));
  return [
    ...voiceAgent.tools.map((t) => t.name).filter((name) => !ready.has(name)),
    ...Object.keys(voiceAgent.built_in_tools ?? {}).filter((name) => !switchedOn[name]),
  ];
}
