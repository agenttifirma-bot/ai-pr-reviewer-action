import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { runCase, CASSETTE_DIR, record, requestHash, replay } from "../eval/run.js";
import { STUB_MODELS, extractAddedLines } from "../eval/stub-models.js";
import { matches, score, summary } from "../eval/score.js";
import { CASES } from "../eval/cases.js";
import { addedLines } from "../src/diff.js";

const readCassette = (name) => JSON.parse(fs.readFileSync(path.join(CASSETTE_DIR, name), "utf8"));
const t = (id) => CASES.find((x) => x.id === id);

test("eval: 10-20 cases, unique ids, both buggy and clean diffs", () => {
  assert.ok(CASES.length >= 10 && CASES.length <= 20);
  assert.equal(new Set(CASES.map((x) => x.id)).size, CASES.length);
  assert.ok(CASES.some((x) => x.clean) && CASES.some((x) => !x.clean));
});

test("eval: every expected finding points at an ADDED line of a file in the case", () => {
  for (const c of CASES) {
    for (const o of c.expected) {
      const f = c.files.find((x) => x.filename === o.file);
      assert.ok(f, `${c.id}: ${o.file}`);
      assert.ok(addedLines(f.patch).has(o.line), `${c.id}: ${o.file}:${o.line} is not an added line`);
      assert.ok(o.keywords.length > 0);
    }
  }
});

test("eval: matching needs same file, line within tolerance and a keyword", () => {
  const o = { file: "a.js", line: 10, keywords: ["sql"] };
  assert.ok(matches({ file: "a.js", line: 11, message: "SQL injection" }, o));
  assert.ok(!matches({ file: "a.js", line: 12, message: "SQL injection" }, o));
  assert.ok(!matches({ file: "b.js", line: 10, message: "SQL injection" }, o));
  assert.ok(!matches({ file: "a.js", line: 10, message: "naming could be better" }, o));
});

test("eval: scoring counts hits, misses, false alarms, duplicates, unknown and errors", () => {
  const c = t("defect-12-two-defects");
  const [evalLine, pageLine] = c.expected.map((o) => o.line);
  const r = score(c, { review: { result: "ok", dropped: 1, findings: [
    { file: "src/calc.js", line: evalLine, message: "eval allows arbitrary code" },
    { file: "src/calc.js", line: evalLine, message: "eval again" },
    { file: "src/calc.js", line: 1, message: "function name is short" },
  ] } });
  assert.deepEqual([r.status, r.hits, r.missed, r.falseAlarms, r.duplicates, r.dropped], ["ok", 1, 1, 1, 1, 1]);
  assert.equal(pageLine > 0, true);
  const u = score(c, { review: { result: "unknown", findings: [] } });
  assert.deepEqual([u.status, u.hits, u.missed, u.falseAlarms], ["unknown", 0, 2, 0]);
  const v = score(c, { review: null, error: "model_reply_no_json" });
  assert.deepEqual([v.status, v.error, v.missed], ["error", "model_reply_no_json", 2]);
  const y = summary([r, u, v]);
  assert.equal(y.recall, 0.167);
  assert.equal(y.precision, 0.5);
  assert.equal(y.unknown, 1);
  assert.equal(y.errors, 1);
});

test("eval: a clean diff with any finding is not silent", () => {
  const c = t("clean-01-parameterized");
  const r = score(c, { review: { result: "ok", findings: [{ file: "src/users-by-id.js", line: 2, message: "SQL injection" }] } });
  assert.equal(r.falseAlarms, 1);
  assert.equal(summary([r]).clean_silent, "0/1");
  assert.equal(summary([r]).precision, 0);
});

test("eval: rule baseline only reads added lines from the model message", () => {
  const user = "<data>\nPR TITLE: x\n\n=== FILE: a.js ===\n@@ -1,2 +1,3 @@\n1:  keep();\n2: +eval(x);\n   -old();\n</data>";
  assert.deepEqual(extractAddedLines(user), [{ file: "a.js", line: 2, code: "eval(x);" }]);
});

test("eval: committed cassettes replay without stale or missing cases (re-record after prompt changes)", async () => {
  const names = fs.readdirSync(CASSETTE_DIR).filter((f) => f.endsWith(".json"));
  assert.ok(names.length >= 2);
  for (const n of names) {
    const r = await replay(readCassette(n));
    assert.deepEqual(r.staleCases, [], n);
    assert.deepEqual(r.missingCases, [], n);
    assert.equal(r.summary.errors, 0, n);
  }
});

test("eval: reference stub scores 100 %, so the pipeline and scorer agree with the expected answers", async () => {
  const r = await replay(readCassette("stub-reference.json"));
  assert.equal(r.summary.recall, 1);
  assert.equal(r.summary.precision, 1);
  assert.equal(r.summary.false_alarms, 0);
});

test("eval: rule baseline numbers match the README quality table", async () => {
  const y = (await replay(readCassette("stub-rule-baseline.json"))).summary;
  assert.deepEqual(
    [y.hits, y.expectedCount, y.false_alarms, y.recall, y.precision, y.clean_silent],
    [7, 13, 1, 0.538, 0.875, "4/5"],
  );
  for (const f of ["README.md", "README.fi.md"]) {
    const md = fs.readFileSync(f, "utf8");
    assert.match(md, /\| 7\/13 \| 1 \| 4\/5 \|/, f);
  }
});

test("eval: a changed request marks the case stale and keeps it out of the score", async () => {
  const n = readCassette("stub-reference.json");
  n.replies["defect-01-sql-concat"].request_sha256 = "0".repeat(64);
  delete n.replies["defect-02-loop-overrun"];
  const r = await replay(n);
  assert.deepEqual(r.staleCases, ["defect-01-sql-concat"]);
  assert.deepEqual(r.missingCases, ["defect-02-loop-overrun"]);
  assert.equal(r.summary.cases, CASES.length - 2);
});

test("eval: re-recording a stub gives the same request hashes and replies as the committed cassette", async () => {
  for (const name of Object.keys(STUB_MODELS)) {
    const fresh = await record({ model: `stub-${name}`, source: "stub", stub: STUB_MODELS[name] });
    const previous = readCassette(`stub-${name}.json`);
    assert.deepEqual(fresh.replies, previous.replies, name);
  }
});

test("eval: live recording sends one call per case, never stores the API key, keeps usage", async (tt) => {
  const key = "eval-test-key-not-real-0123456789";
  const calls = [];
  tt.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), auth: init.headers.authorization });
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: STUB_MODELS.reference(body, t("defect-01-sql-concat")) } }], usage: { prompt_tokens: 500, completion_tokens: 40 } }), { status: 200 });
  });
  const cases = [t("defect-01-sql-concat")];
  const cassette = await record({ model: "m", source: "elava", live: { base: "http://localhost:9/v1", apiKey: key } }, cases);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:9/v1/chat/completions");
  assert.equal(calls[0].auth, `Bearer ${key}`);
  assert.ok(!JSON.stringify(cassette).includes(key));
  const v = cassette.replies["defect-01-sql-concat"];
  assert.deepEqual(v.usage, { input: 500, output: 40 });
  const r = await replay(cassette, cases);
  assert.equal(r.summary.hits, 1);
});

test("eval: request hash depends on system and user text only", () => {
  const b = (s, u, m) => ({ model: m, messages: [{ content: s }, { content: u }] });
  assert.equal(requestHash(b("s", "u", "a")), requestHash(b("s", "u", "b")));
  assert.notEqual(requestHash(b("s", "u", "a")), requestHash(b("s2", "u", "a")));
});

test("eval: the replay path goes through run() and its validation (findings on unseen lines are dropped)", async () => {
  const c = t("defect-01-sql-concat");
  const r = await runCase(c, { model: "x", answer: () => ({ content: JSON.stringify({ result: "ok", summary: "s", findings: [{ file: "src/users.js", line: 99, severity: "high", confidence: "high", message: "SQL injection" }] }) }) });
  assert.equal(r.review.findings.length, 0);
  assert.equal(r.review.dropped, 1);
});
