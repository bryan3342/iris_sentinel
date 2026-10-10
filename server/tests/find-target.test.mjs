import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Load the actual TypeScript sources without emitting files or adding a test runner.
async function moduleUrl(path, replacements = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  let output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [from, to] of Object.entries(replacements)) output = output.replaceAll(from, to);
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}
const providerUrl = await moduleUrl("../src/page-understanding.ts");
const { GeminiPageUnderstanding } = await import(providerUrl);
const { createWorker } = await import(await moduleUrl("../src/index.ts", { "./page-understanding": providerUrl }));
const input = { request: "Find history", targets: [{ id: 1, label: "History", role: "link" }] };
const env = { GEMINI_API_KEY: "test-placeholder" };
const upstream = (selection, finishReason = "STOP") => Response.json({
  candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(selection) }] } }],
});
const httpRequest = (body = input, headers = { "Content-Type": "application/json" }) =>
  new Request("http://localhost/gemini/find-target", {
    method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body),
  });
const workerFor = send => createWorker(new GeminiPageUnderstanding(env, send));

test("HTTP request reaches Gemini and returns a supplied ID", async () => {
  let calls = 0;
  const worker = workerFor(async (url, options) => {
    calls++;
    assert.match(url, /models\/gemini-3\.8-flash:generateContent$/);
    assert.equal(options.headers["x-goog-api-key"], env.GEMINI_API_KEY);
    assert.equal(options.method, "POST");
    const body = JSON.parse(options.body);
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), input);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "low");
    assert.ok(options.signal instanceof AbortSignal);
    return upstream({ targetId: 1 });
  });
  const response = await worker.fetch(httpRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { targetId: 1 });
  assert.equal(calls, 1);
});

test("fetch is called without the provider as its receiver", async () => {
  const provider = new GeminiPageUnderstanding(env, async function () {
    assert.equal(this, undefined);
    return upstream({ targetId: 1 });
  });
  assert.deepEqual(await provider.findTarget(input), { targetId: 1 });
});

for (const request of ["Find an absent link", "Find history or contact"]) {
  test(`no match or ambiguity: ${request}`, async () => {
    const response = await workerFor(async () => upstream({ targetId: null }))
      .fetch(httpRequest({ ...input, request }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { targetId: null });
  });
}

for (const selection of [{ targetId: 99 }, { targetId: "1" }, {}, null, { targetId: 1, text: "extra" }]) {
  test(`reject invalid model selection ${JSON.stringify(selection)}`, async () => {
    const response = await workerFor(async () => upstream(selection)).fetch(httpRequest());
    assert.equal(response.status, 502);
  });
}

for (const [name, send, status] of [
  ["malformed JSON", async () => new Response("not JSON"), 502],
  ["malformed generated JSON", async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "not JSON" }] } }] }), 502],
  ["missing candidates", async () => Response.json({}), 502],
  ["truncated result", async () => upstream({ targetId: 1 }, "MAX_TOKENS"), 502],
  ["timeout", async () => { throw new DOMException("sensitive details", "TimeoutError"); }, 504],
  ["network failure", async () => { throw new Error("sensitive details"); }, 502],
  ...[400, 401, 403, 429, 500, 503].map(code => [
    `upstream HTTP ${code}`, async () => new Response("sensitive details", { status: code }),
    code === 429 || code >= 500 ? 503 : 502,
  ]),
]) {
  test(name, async () => {
    let calls = 0;
    const response = await workerFor(async (...args) => { calls++; return send(...args); }).fetch(httpRequest());
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /sensitive details|test-placeholder/);
    assert.equal(calls, 1, "failures are not retried");
  });
}

for (const body of [null, "{broken", {}, { ...input, request: " " },
  { ...input, request: "x".repeat(501) }, { ...input, targets: [] },
  { ...input, targets: Array(101).fill(input.targets[0]) },
  { ...input, targets: [input.targets[0], input.targets[0]] },
  ...[null, { id: 0, label: "a", role: "link" }, { id: 1.5, label: "a", role: "link" },
    { id: 1, label: " ", role: "link" }, { id: 1, label: "x".repeat(201), role: "link" },
    { id: 1, label: "a", role: "other" }].map(target => ({ ...input, targets: [target] })),
]) {
  test(`invalid input is rejected: ${JSON.stringify(body).slice(0, 70)}`, async () => {
    const response = await workerFor(async () => assert.fail("Gemini must not be called"))
      .fetch(httpRequest(body));
    assert.equal(response.status, 400);
  });
}

test("body limit and content type are enforced before Gemini", async () => {
  const worker = workerFor(async () => assert.fail("Gemini must not be called"));
  assert.equal((await worker.fetch(httpRequest("x".repeat(65537)))).status, 413);
  assert.equal((await worker.fetch(httpRequest(input, { "Content-Type": "text/plain" }))).status, 415);
});

test("safe errors distinguish network, token limit, and invalid generated JSON", async () => {
  for (const [send, message] of [
    [async () => { throw new Error("secret network details"); }, /Could not connect to Gemini/],
    [async () => upstream({ targetId: 1 }, "MAX_TOKENS"), /output token limit/],
    [async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "secret invalid text" }] } }] }), /not valid JSON/],
  ]) {
    const response = await workerFor(send).fetch(httpRequest());
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.match(body, message);
    assert.doesNotMatch(body, /secret/);
  }
});

test("configuration errors and existing routes", async () => {
  const worker = createWorker();
  assert.equal((await worker.fetch(httpRequest())).status, 503);
  assert.equal((await worker.fetch(httpRequest(), { ...env, GEMINI_MODEL: "bad/model" })).status, 503);
  assert.equal((await worker.fetch(new Request("http://localhost/gemini/find-target"))).status, 405);
  const health = await worker.fetch(new Request("http://localhost/health"));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", service: "iris-server" });
  assert.equal((await worker.fetch(new Request("http://localhost/unknown"))).status, 404);
});
