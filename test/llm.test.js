import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { chat, checkBaseUrl, LLMError } from "../src/llm.js";

function server(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const s = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
        handler(req, res);
      });
    });
    s.listen(0, "127.0.0.1", () => resolve({ s, seen, url: `http://127.0.0.1:${s.address().port}/v1` }));
  });
}
const args = (url, over = {}) => ({ baseUrl: url, apiKey: "k", model: "m", system: "S", user: "U", maxOutputTokens: 123, timeoutMs: 2000, ...over });
const ok = (res, content = "hello", usage) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content } }], usage })); };

test("sends one tool-less, non-streaming, temperature-0 request with the output ceiling", async () => {
  const { s, seen, url } = await server((req, res) => ok(res, "hi", { prompt_tokens: 10, completion_tokens: 5 }));
  try {
    const r = await chat(args(url));
    assert.deepEqual(r, { content: "hi", usage: { input: 10, output: 5 } });
    const req = seen[0];
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, "Bearer k");
    assert.equal(req.body.max_tokens, 123);
    assert.equal(req.body.temperature, 0);
    assert.equal(req.body.tools, undefined);
    assert.equal(req.body.stream, undefined);
    assert.deepEqual(req.body.messages.map((m) => m.role), ["system", "user"]);
  } finally { s.close(); }
});

test("usage is null when the endpoint does not report it", async () => {
  const { s, url } = await server((req, res) => ok(res, "hi"));
  try { assert.equal((await chat(args(url))).usage, null); } finally { s.close(); }
});

test("HTTP errors, empty replies, bad JSON and oversized replies become coded errors", async () => {
  const cases = [
    [(req, res) => { res.statusCode = 500; res.end("x"); }, "llm_http_500"],
    [(req, res) => { res.statusCode = 429; res.end("x"); }, "llm_http_429"],
    [(req, res) => ok(res, ""), "llm_empty_reply"],
    [(req, res) => res.end("not json"), "llm_bad_json"],
    [(req, res) => res.end(JSON.stringify({ choices: [{ message: { content: "x".repeat(300_000) } }] })), "llm_response_too_large"],
  ];
  for (const [handler, code] of cases) {
    const { s, url } = await server(handler);
    try {
      await assert.rejects(chat(args(url)), (e) => e instanceof LLMError && e.code === code, code);
    } finally { s.close(); }
  }
});

test("a slow endpoint times out", async () => {
  const { s, url } = await server(() => {});
  try {
    await assert.rejects(chat(args(url, { timeoutMs: 60 })), (e) => e.code === "llm_timeout");
  } finally { s.closeAllConnections?.(); s.close(); }
});

test("redirects are refused, so the key is never sent to another host", async () => {
  const other = await server((req, res) => ok(res, "stolen"));
  const { s, url } = await server((req, res) => { res.statusCode = 307; res.setHeader("location", other.url + "/chat/completions"); res.end(); });
  try {
    await assert.rejects(chat(args(url)), (e) => e.code === "llm_network");
    assert.equal(other.seen.length, 0);
  } finally { s.close(); other.s.close(); }
});

test("checkBaseUrl: https only (http only for localhost), no credentials in the URL, trailing slashes trimmed", () => {
  assert.equal(checkBaseUrl("https://x.example/v1/"), "https://x.example/v1");
  assert.equal(checkBaseUrl("http://localhost:4000/v1"), "http://localhost:4000/v1");
  for (const bad of ["http://x.example/v1", "ftp://x/v1", "not a url", "https://user:pw@x.example/v1", ""]) {
    assert.throws(() => checkBaseUrl(bad), LLMError, bad);
  }
});
