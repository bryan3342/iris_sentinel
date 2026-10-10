// Local setup check only. This is not a public Worker endpoint.
const key = process.env.ELEVENLABS_API_KEY?.trim();
const agent = process.env.ELEVENLABS_AGENT_ID?.trim();

if (!key || key.endsWith("replace_with_your_key")) {
  console.error("Set ELEVENLABS_API_KEY in server/.dev.vars before running this check.");
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

// Minting a signed URL does not start a conversation, so this spends no conversation
// minutes, but it is a real authenticated call to a live vendor API.
const url = new URL("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url");
url.searchParams.set("agent_id", agent);
url.searchParams.set("include_conversation_id", "true");

const short = `${agent.slice(0, 11)}...${agent.slice(-4)}`;

try {
  const response = await fetch(url, {
    headers: { "xi-api-key": key },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const hints = {
      400: "The key is likely an API key ID rather than an sk_ API key, or the agent ID is malformed.",
      401: "Check your API key.",
      403: "Check that the key has Conversational AI permission.",
      404: "Check that ELEVENLABS_AGENT_ID exists in your workspace.",
      429: "Check your quota and billing, or retry later.",
    };
    // Do not print upstream bodies or request headers, which may contain secrets.
    console.error(`ElevenLabs returned HTTP ${response.status}. ${hints[response.status] || "Retry later or check the ElevenLabs dashboard."}`);
    process.exitCode = 1;
  } else {
    const data = await response.json();
    // Apply the same validation as the Worker adapter, then report only the verdict.
    // The signed URL is a credential for one conversation; never print it.
    let valid = false;
    try {
      const signed = new URL(data.signed_url);
      valid = typeof data.signed_url === "string" && data.signed_url.length <= 4096 &&
        signed.protocol === "wss:" && signed.host === "api.elevenlabs.io" &&
        signed.pathname === "/v1/convai/conversation" &&
        !signed.username && !signed.password && !signed.hash &&
        signed.searchParams.get("agent_id") === agent &&
        Boolean(signed.searchParams.get("conversation_signature"));
    } catch {
      valid = false;
    }
    if (!valid) {
      console.error("ElevenLabs authenticated but returned an unusable signed URL. Check the agent configuration.");
      process.exitCode = 1;
    } else {
      console.log(`ElevenLabs connection succeeded (${short}).`);
      console.log("Signed URL minted and validated: true");
    }
  }
} catch {
  console.error("ElevenLabs check failed: network, timeout, or invalid response. Check your connection and retry.");
  process.exitCode = 1;
}
