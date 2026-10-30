import assert from "node:assert/strict";
import test from "node:test";
import { main } from "../src/index.js";
import { extractJson, ValidationError } from "../src/validate.js";
import { baseEnv, fakeNet, okReply } from "./helpers.js";

async function runMain(net, env) {
  const orig = globalThis.fetch;
  const origLog = console.log;
  const lines = [];
  globalThis.fetch = net.fetchImpl;
  console.log = (m) => lines.push(String(m));
  try {
    const code = await main(env);
    return { code, lines };
  } finally {
    globalThis.fetch = orig;
    console.log = origLog;
  }
}

test("main: a successful review exits 0 and logs the outcome", async () => {
  const net = fakeNet({ reply: okReply() });
  const { code, lines } = await runMain(net, baseEnv());
  assert.equal(code, 0);
  assert.ok(lines.includes("::notice::ai-pr-reviewer: reviewed"));
  assert.equal(net.state.comments.length, 1);
});

test("main: a skipped run (no api key) also exits 0 and names the outcome", async () => {
  const net = fakeNet({});
  const { code, lines } = await runMain(net, baseEnv({ "INPUT_API-KEY": "" }));
  assert.equal(code, 0);
  assert.ok(lines.includes("::notice::ai-pr-reviewer: skipped_no_key"));
  assert.equal(net.calls.length, 0);
});

test("main: config errors exit 1 with an ::error:: line, even without fail-on-error", async () => {
  const net = fakeNet({});
  const { code, lines } = await runMain(net, baseEnv({ GITHUB_EVENT_NAME: "pull_request_target" }));
  assert.equal(code, 1);
  assert.ok(lines.some((l) => l.startsWith("::error::ai-pr-reviewer: pull_request_target_refused")));
  assert.equal(net.calls.length, 0);
});

test("main: a malformed model reply is a known error code, posts no review, exits 0", async () => {
  const net = fakeNet({ reply: "I cannot answer in JSON" });
  const { code, lines } = await runMain(net, baseEnv());
  assert.equal(code, 0);
  assert.ok(lines.some((l) => l.startsWith("::warning::") && l.includes("model_reply_no_json") && l.includes("no review posted")));
  assert.equal(net.state.comments.length, 1);
  assert.match(net.state.comments[0].body, /Review in progress/);
});

test("main: GitHub API failures are reported by code and honour fail-on-error", async () => {
  const net = fakeNet({});
  const failing = { ...net, fetchImpl: async () => new Response("{}", { status: 403 }) };
  const soft = await runMain(failing, baseEnv());
  assert.equal(soft.code, 0);
  assert.ok(soft.lines.some((l) => l.includes("github_http_403")));
  const hard = await runMain(failing, baseEnv({ "INPUT_FAIL-ON-ERROR": "true" }));
  assert.equal(hard.code, 1);
});

test("main: unknown errors are reported as unexpected_error without leaking their message", async () => {
  const env = baseEnv();
  Object.defineProperty(env, "GITHUB_API_URL", { get() { throw new Error("secret-detail-xyz"); } });
  const { code, lines } = await runMain(fakeNet({}), env);
  assert.equal(code, 0);
  const all = lines.join("\n");
  assert.ok(all.includes("::warning::ai-pr-reviewer: unexpected_error; no review posted"));
  assert.ok(!all.includes("secret-detail-xyz"));
  const hard = Object.defineProperty(baseEnv({ "INPUT_FAIL-ON-ERROR": "true" }), "GITHUB_API_URL", { get() { throw new Error("x"); } });
  assert.equal((await runMain(fakeNet({}), hard)).code, 1);
});

test("extractJson: braces that do not form valid JSON are a bad_json error", () => {
  assert.throws(() => extractJson("{not: valid}"), (e) => e instanceof ValidationError && e.code === "model_reply_bad_json");
  assert.throws(() => extractJson("no braces"), (e) => e.code === "model_reply_no_json");
  assert.throws(() => extractJson(null), (e) => e.code === "model_reply_not_text");
});
