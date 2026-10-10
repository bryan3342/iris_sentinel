// Local setup check only. This is not a public Worker endpoint. It sends two small
// requests and no page content: a fixed text prompt, then a one-pixel image through
// the Worker's own Gemini adapter, so a request format Gemini refuses shows up here
// instead of in the browser.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

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

const hints = {
  400: "Check the key and model configuration.",
  401: "Check your API key.",
  403: "Check API key permissions and project access.",
  404: "Check that GEMINI_MODEL is available to your project.",
  429: "Check your quota and billing, or retry later.",
};
// Do not print upstream bodies or request headers, which may contain secrets.
const httpFailure = (status) => `Gemini returned HTTP ${status}. ${hints[status] || "Retry later or check Google AI Studio."}`;

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
    console.error(httpFailure(response.status));
    process.exit(1);
  }
  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts
    ?.filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text).join("").trim();
  if (!text) {
    console.error("Gemini responded but returned no text. Check model output limits or safety settings.");
    process.exit(1);
  }
  // Only report the match; do not echo arbitrary model output.
  console.log(`Gemini connection succeeded (${model}).`);
  console.log(`Expected reply matched: ${text === "Iris Gemini connection works"}`);
} catch {
  console.error("Gemini check failed: network, timeout, or invalid response. Check your connection and retry.");
  process.exit(1);
}

// The same request the Worker makes for find_target: image, target list and answer schema.
const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL('../src/multimodal.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022' });
const { GeminiMultimodal } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
let status = 0;
const send = async (url, init) => { const response = await fetch(url, init); status = response.status; return response; };
const viewport = { width: 1, height: 1, offsetLeft: 0, offsetTop: 0, scale: 1, scrollX: 0, scrollY: 0 };
const input = {
  protocolVersion: '0.1', requestId: 'check_gemini_request', operation: 'find_target',
  binding: { tabToken: 'check_gemini_tab', documentToken: 'check_gemini_document', revision: 0, captureId: 'check_gemini_capture', viewport },
  // One white pixel.
  image: { mimeType: 'image/png', width: 1, height: 1, data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC' },
  request: 'More information', targetsTruncated: false,
  targets: [{ id: 1, role: 'link', label: 'More information', rect: { x: 0, y: 0, width: 1, height: 1 } }],
};
try {
  const result = await new GeminiMultimodal({ GEMINI_API_KEY: key, GEMINI_MODEL: model }, send)
    .findTarget(input, AbortSignal.timeout(40_000));
  console.log('Page understanding request accepted: true');
  console.log(`Expected target matched: ${result.targetId === 1}`);
} catch (error) {
  const code = typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED';
  console.error(`Page understanding request failed: ${code}.${status && status !== 200 ? ` ${httpFailure(status)}` : ''}`);
  process.exitCode = 1;
}
