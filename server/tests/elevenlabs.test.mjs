import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { missingTools, voiceAgent } from "../scripts/elevenlabs.mjs";

// A stand-in for the ElevenLabs agents API: Iris's client tools are all attached,
// and `builtIn` is the agent's switched-on system tools. No key is needed or sent.
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function agentApi(builtIn) {
  const tools = voiceAgent.tools.map((tool, i) => ({ id: `tool_${i}`, tool_config: { type: "client", name: tool.name, expects_response: true } }));
  const agent = { conversation_config: { agent: { prompt: { tool_ids: tools.map((t) => t.id), built_in_tools: builtIn } } } };
  globalThis.fetch = async (url) => Response.json(new URL(url).pathname.endsWith("/tools") ? { tools } : agent);
}

test("names skip_turn as missing until the agent has it switched on, so commands that work can stay silent", async () => {
  agentApi({});
  assert.deepEqual(await missingTools("unused", "agent_test"), ["skip_turn"]);
  agentApi({ skip_turn: { type: "system", name: "skip_turn", params: { system_tool_type: "skip_turn" } } });
  assert.deepEqual(await missingTools("unused", "agent_test"), []);
});
