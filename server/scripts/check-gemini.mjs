// Local setup check only. This is not a public Worker endpoint.
const key = process.env.GEMINI_API_KEY?.trim();
const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";

if (!key || key === "replace_with_your_key") {
  console.error("Set GEMINI_API_KEY in server/.dev.vars before running this check.");
  process.exit(1);
}
if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
  console.error("GEMINI_MODEL must be a model ID, such as gemini-3.8-flash.");
  process.exit(1);
}

try {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Reply with exactly: Iris Gemini connection works" }] }],
        generationConfig: { maxOutputTokens: 256 },
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    const hints = {
      400: "Check the key and model configuration.",
      401: "Check your API key.",
      403: "Check API key permissions and project access.",
      404: "Check that GEMINI_MODEL is available to your project.",
      429: "Check your quota and billing, or retry later.",
    };
    // Do not print upstream bodies or request headers, which may contain secrets.
    console.error(`Gemini returned HTTP ${response.status}. ${hints[response.status] || "Retry later or check Google AI Studio."}`);
    process.exitCode = 1;
  } else {
    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts
      ?.filter((part) => !part.thought && typeof part.text === "string")
      .map((part) => part.text).join("").trim();
    if (!text) {
      console.error("Gemini responded but returned no text. Check model output limits or safety settings.");
      process.exitCode = 1;
    } else {
      // Only report the match; do not echo arbitrary model output.
      console.log(`Gemini connection succeeded (${model}).`);
      console.log(`Expected reply matched: ${text === "Iris Gemini connection works"}`);
    }
  }
} catch {
  console.error("Gemini check failed: network, timeout, or invalid response. Check your connection and retry.");
  process.exitCode = 1;
}
