import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { cost, overheadTokens, select } from "../src/budget.js";
import { addedLines, numberedPatch, skipReason } from "../src/diff.js";
import { client, GitHubError } from "../src/github.js";
import { ConfigError, run } from "../src/index.js";
import { MAX_COMMENT_PAGES } from "../src/limits.js";
import { chat, LLMError } from "../src/llm.js";
import { validate } from "../src/validate.js";
import { baseEnv, eventFile, fakeNet, json, okReply, silent } from "./helpers.js";

const llm = { baseUrl: "https://llm.example/v1", apiKey: "k", model: "m", system: "s", user: "u", maxOutputTokens: 10 };

// --- index.run: configuration ---

test("run: a malformed GITHUB_REPOSITORY is a config error before any network call", async () => {
  const net = fakeNet({ reply: okReply() });
  for (const repo of ["nope", "a/b/c", "", "a b/c", "a/b?x=1", "a/b\n"]) {
    await assert.rejects(
      run({ env: baseEnv({ GITHUB_REPOSITORY: repo }), fetchImpl: net.fetchImpl, log: silent }),
      (e) => e instanceof ConfigError && e.code === "bad_repository",
      repo,
    );
  }
  assert.equal(net.calls.length, 0);
});

test("run: a payload with a bad pull request number or head sha is refused", async () => {
  const net = fakeNet({ reply: okReply() });
  for (const over of [{ number: 0 }, { number: -3 }, { number: 1.5 }, { sha: "XYZ" }, { sha: "abc" }, { sha: "A".repeat(40) }]) {
    await assert.rejects(
      run({ env: baseEnv({ GITHUB_EVENT_PATH: eventFile(over) }), fetchImpl: net.fetchImpl, log: silent }),
      (e) => e instanceof ConfigError && e.code === "bad_event_payload",
      JSON.stringify(over),
    );
  }
  assert.equal(net.calls.length, 0);
});

test("run: GITHUB_TOKEN is used when the github-token input is empty", async () => {
  const net = fakeNet({ reply: okReply() });
  const env = baseEnv({ "INPUT_GITHUB-TOKEN": "", GITHUB_TOKEN: "env-token" });
  const r = await run({ env, fetchImpl: net.fetchImpl, log: silent });
  assert.equal(r.outcome, "reviewed");
  const gh = net.calls.filter((c) => c.url.startsWith("https://api.github.com"));
  assert.ok(gh.length > 0);
  for (const c of gh) assert.equal(c.headers.authorization, "Bearer env-token");
});

test("run: GITHUB_API_URL redirects GitHub calls (Enterprise Server), the model URL is unaffected", async () => {
  const net = fakeNet({ reply: okReply() });
  const env = baseEnv({ GITHUB_API_URL: "https://ghe.example/api/v3" });
  const r = await run({ env, fetchImpl: net.fetchImpl, log: silent });
  assert.equal(r.outcome, "reviewed");
  assert.ok(net.calls.some((c) => c.url.startsWith("https://ghe.example/api/v3/repos/octo/demo/pulls/7/files")));
  assert.ok(!net.calls.some((c) => c.url.startsWith("https://api.github.com")));
  assert.equal(net.llmCalls().length, 1);
});

test("run: an insecure GITHUB_API_URL is refused before any call", async () => {
  const net = fakeNet({ reply: okReply() });
  const env = baseEnv({ GITHUB_API_URL: "http://ghe.example/api" });
  await assert.rejects(run({ env, fetchImpl: net.fetchImpl, log: silent }), (e) => e instanceof GitHubError && e.code === "github_api_must_be_https");
  assert.equal(net.calls.length, 0);
});

test("run: prices from the inputs turn token usage into an estimated cost in the comment", async () => {
  const net = fakeNet({ reply: okReply() });
  const env = baseEnv({ "INPUT_PRICE-IN": "1", "INPUT_PRICE-OUT": "2" });
  await run({ env, fetchImpl: net.fetchImpl, log: silent });
  // fake model reports 1200 in / 80 out: (1200*1 + 80*2) / 1e6 = 0.00136
  assert.match(net.state.comments.at(-1).body, /est\. cost \$0\.0014/);
});

test("run: without prices, or with junk prices, no cost is shown", async () => {
  for (const over of [{}, { "INPUT_PRICE-IN": "abc", "INPUT_PRICE-OUT": "-1" }, { "INPUT_PRICE-IN": "0", "INPUT_PRICE-OUT": "0" }]) {
    const net = fakeNet({ reply: okReply() });
    await run({ env: baseEnv(over), fetchImpl: net.fetchImpl, log: silent });
    assert.ok(!net.state.comments.at(-1).body.includes("est. cost"), JSON.stringify(over));
  }
});

// --- github client ---

test("github: a non-array reply is a bad_reply error for files and for comments", async () => {
  const gh = client({ token: "t", fetchImpl: async () => json({ message: "surprise" }) });
  await assert.rejects(gh.listFiles("o", "r", 1), (e) => e instanceof GitHubError && e.code === "github_bad_reply");
  await assert.rejects(gh.listBotComments("o", "r", 1), (e) => e instanceof GitHubError && e.code === "github_bad_reply");
});

test("github: a body that is not JSON is reported as a network error, not a crash", async () => {
  const gh = client({ token: "t", fetchImpl: async () => new Response("<html>nope</html>", { status: 200 }) });
  await assert.rejects(gh.listFiles("o", "r", 1), (e) => e instanceof GitHubError && e.code === "github_network");
});

test("github: listBotComments reads the next page only when the page was full", async () => {
  const urls = [];
  const full = Array.from({ length: 100 }, (_, i) => ({ id: i, user: { type: "Bot" } }));
  const gh = client({
    token: "t",
    fetchImpl: async (url) => {
      urls.push(url);
      return json(urls.length === 1 ? full : [{ id: 500, user: { type: "Bot" } }]);
    },
  });
  const got = await gh.listBotComments("o", "r", 5);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /per_page=100&page=1$/);
  assert.match(urls[1], /per_page=100&page=2$/);
  assert.equal(got.length, 101);
});

test("github: listBotComments stops at the page limit however many comments there are", async () => {
  let n = 0;
  const full = Array.from({ length: 100 }, (_, i) => ({ id: i, user: { type: "Bot" } }));
  const gh = client({ token: "t", fetchImpl: async () => { n += 1; return json(full); } });
  const got = await gh.listBotComments("o", "r", 5);
  assert.equal(n, MAX_COMMENT_PAGES);
  assert.equal(got.length, 100 * MAX_COMMENT_PAGES);
});

test("github: a trailing slash in the API URL does not double up, and http is fine for localhost only", async () => {
  const urls = [];
  const gh = client({ token: "t", apiUrl: "https://ghe.example/api/v3//", fetchImpl: async (u) => { urls.push(u); return json([]); } });
  await gh.listFiles("o", "r", 2);
  assert.equal(urls[0], "https://ghe.example/api/v3/repos/o/r/pulls/2/files?per_page=100&page=1");
  assert.doesNotThrow(() => client({ token: "t", apiUrl: "http://localhost:8080" }));
  assert.doesNotThrow(() => client({ token: "t", apiUrl: "http://127.0.0.1:8080" }));
  assert.throws(() => client({ token: "t", apiUrl: "http://example.com" }), (e) => e.code === "github_api_must_be_https");
});

test("github: a request that hangs is aborted and reported as github_timeout", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const gh = client({
      token: "t",
      fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))),
    });
    const pending = assert.rejects(gh.listFiles("o", "r", 1), (e) => e instanceof GitHubError && e.code === "github_timeout");
    mock.timers.tick(60_000);
    await pending;
  } finally {
    mock.timers.reset();
  }
});

// --- llm ---

test("llm: usage is null when only one of the two token counts is reported", async () => {
  for (const usage of [{ prompt_tokens: 5 }, { completion_tokens: 5 }, { prompt_tokens: "5", completion_tokens: 5 }]) {
    const r = await chat({ ...llm, fetchImpl: async () => json({ choices: [{ message: { content: "hi" } }], usage }) });
    assert.equal(r.content, "hi");
    assert.equal(r.usage, null, JSON.stringify(usage));
  }
});

test("llm: a reply whose content is not a string is an empty-reply error", async () => {
  for (const data of [{ choices: [{ message: { content: 42 } }] }, { choices: [] }, {}, { choices: [{ message: {} }] }]) {
    await assert.rejects(chat({ ...llm, fetchImpl: async () => json(data) }), (e) => e instanceof LLMError && e.code === "llm_empty_reply", JSON.stringify(data));
  }
});

test("llm: a network failure is llm_network and a bad base URL stops before any request", async () => {
  await assert.rejects(chat({ ...llm, fetchImpl: async () => { throw new TypeError("fetch failed"); } }), (e) => e.code === "llm_network");
  let called = false;
  await assert.rejects(chat({ ...llm, baseUrl: "not a url", fetchImpl: async () => { called = true; return json({}); } }), (e) => e.code === "llm_bad_base_url");
  assert.equal(called, false);
});

// --- diff ---

test("numberedPatch and addedLines cope with CRLF patches", () => {
  const patch = "@@ -1 +1,2 @@\r\n a\r\n+b";
  assert.equal(numberedPatch(patch), "@@ -1 +1,2 @@\n1:  a\n2: +b");
  assert.deepEqual([...addedLines(patch)], [2]);
});

test("numberedPatch drops text before the first hunk header", () => {
  assert.equal(numberedPatch("junk\n+not a change\n@@ -1 +1 @@\n+x"), "@@ -1 +1 @@\n1: +x");
});

test("skipReason: extension matching ignores case and directory depth, but not look-alike names", () => {
  const f = (filename) => ({ filename, status: "modified", patch: "@@ -1 +1 @@\n+x" });
  for (const n of ["LOGO.PNG", "a/b/c/.ENV", "x/Package-Lock.JSON", "deep/dir/server.PEM"]) {
    assert.equal(skipReason(f(n)), "excluded file type", n);
  }
  for (const n of ["src/environment.js", "docs/keys.md", "src/png.js"]) {
    assert.equal(skipReason(f(n)), null, n);
  }
  assert.equal(skipReason({ filename: 5, patch: "x" }), "invalid entry");
  assert.equal(skipReason({ filename: "a.js", status: "modified", patch: "" }), "no text diff (binary or too large)");
});

// --- validate ---

test("validate: every malformed finding is dropped and counted, valid ones survive", () => {
  const allowed = new Map([["a.js", new Set([1, 2])]]);
  const ok = { file: "a.js", line: 2, severity: "low", confidence: "medium", message: "fine" };
  const raw = {
    result: "ok",
    summary: "s",
    findings: [
      { ...ok, severity: "critical" },
      { ...ok, line: "2" },
      { ...ok, line: 1.5 },
      { ...ok, line: 99 },
      { ...ok, confidence: "low" },
      { ...ok, message: "<b></b>" },
      { ...ok, message: 42 },
      { ...ok, file: "b.js" },
      null,
      "text",
      ok,
    ],
  };
  const v = validate(raw, allowed);
  assert.equal(v.findings.length, 1);
  assert.equal(v.findings[0].message, "fine");
  assert.equal(v.dropped, 10);
});

test("validate: findings that is not an array is an empty ok result; unknown without reason gets a default", () => {
  const allowed = new Map();
  const v = validate({ result: "ok", findings: "lots" }, allowed);
  assert.deepEqual([v.result, v.findings.length, v.dropped], ["ok", 0, 0]);
  assert.equal(validate({ result: "unknown" }, allowed).reason, "no reason given");
  assert.equal(validate({ result: "unknown", reason: "<i></i>" }, allowed).reason, "no reason given");
});

// --- budget ---

test("select: no files keeps nothing and charges only the overhead", () => {
  const r = select([], 1000);
  assert.deepEqual([r.kept, r.skipped, r.inputTokens], [[], [], overheadTokens()]);
});

test("select: a ceiling below the overhead keeps nothing and reports every file", () => {
  const r = select([{ filename: "a.js", text: "x" }, { filename: "b.js", text: "y" }], 1);
  assert.equal(r.kept.length, 0);
  assert.deepEqual(r.skipped.map((s) => s.filename).sort(), ["a.js", "b.js"]);
});

test("cost: one price is enough, a missing price counts as zero, junk prices give null", () => {
  assert.equal(cost(10, 10, 0, 5), 50 / 1e6);
  assert.equal(cost(10, 10, 2, 0), 20 / 1e6);
  assert.equal(cost(10, 10, undefined, undefined), null);
  assert.equal(cost(10, 10, -1, -1), null);
  assert.equal(cost(10, 10, NaN, NaN), null);
});
