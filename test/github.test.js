import assert from "node:assert/strict";
import test from "node:test";
import { client, GitHubError } from "../src/github.js";
import { json } from "./helpers.js";

test("listFiles: follows pages and flags truncation at the list limit", async () => {
  const calls = [];
  const page = (n) => Array.from({ length: n }, (_, i) => ({ filename: `f${calls.length}-${i}` }));
  const gh = client({ token: "t", fetchImpl: async (url) => { calls.push(url); return json(page(100)); } });
  const r = await gh.listFiles("o", "r", 5);
  assert.equal(calls.length, 3);
  assert.equal(r.files.length, 300);
  assert.equal(r.truncated, true);
  const gh2 = client({ token: "t", fetchImpl: async () => json(page(3)) });
  assert.deepEqual(await gh2.listFiles("o", "r", 5).then((x) => [x.files.length, x.truncated]), [3, false]);
});

test("listBotComments: only bot-authored comments count, so a human cannot plant a marker", async () => {
  const gh = client({ token: "t", fetchImpl: async () => json([{ id: 1, user: { type: "User" } }, { id: 2, user: { type: "Bot" } }, { id: 3 }, null]) });
  assert.deepEqual((await gh.listBotComments("o", "r", 5)).map((c) => c.id), [2]);
});

test("requests carry the token, never follow redirects, and use the right verbs and paths", async () => {
  const calls = [];
  const gh = client({ token: "tok", fetchImpl: async (url, init) => { calls.push({ url, init }); return json({ id: 1 }); } });
  await gh.create("o", "r", 5, "hi");
  await gh.update("o", "r", 9, "yo");
  assert.equal(calls[0].url, "https://api.github.com/repos/o/r/issues/5/comments");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[1].url, "https://api.github.com/repos/o/r/issues/comments/9");
  assert.equal(calls[1].init.method, "PATCH");
  for (const c of calls) {
    assert.equal(c.init.redirect, "error");
    assert.equal(c.init.headers.authorization, "Bearer tok");
  }
});

test("errors are coded; non-https API URLs are refused", async () => {
  const gh = client({ token: "t", fetchImpl: async () => json({}, 404) });
  await assert.rejects(gh.listFiles("o", "r", 1), (e) => e instanceof GitHubError && e.code === "github_http_404");
  const gh2 = client({ token: "t", fetchImpl: async () => { throw new Error("x"); } });
  await assert.rejects(gh2.listFiles("o", "r", 1), (e) => e.code === "github_network");
  assert.throws(() => client({ token: "t", apiUrl: "http://github.example/api" }), GitHubError);
});
