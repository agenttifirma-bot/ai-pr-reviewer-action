import assert from "node:assert/strict";
import test from "node:test";
import { marker, parseMarker, render } from "../src/render.js";

const base = { sha: "a".repeat(40), runs: 2, skipped: [], redacted: 0, usage: { input: 1000, output: 50 }, costUsd: 0.0123, model: "m", reviewedFiles: 3 };
const review = (over = {}) => ({ result: "ok", summary: "Sum.", reason: "", findings: [], dropped: 0, ...over });

test("marker round-trips and rejects malformed markers", () => {
  assert.deepEqual(parseMarker(marker("abc1234", 3) + "\nrest"), { sha: "abc1234", runs: 3 });
  for (const bad of ["", "<!-- ai-pr-reviewer:v1 sha=XYZ runs=1 -->", "text <!-- ai-pr-reviewer:v1 sha=abc1234 runs=1 -->", null, undefined]) {
    assert.equal(parseMarker(bad), null);
  }
});

test("render: findings, honest empty result, footer with usage and cost", () => {
  const body = render({ ...base, review: review({ findings: [{ file: "src/a.js", line: 2, severity: "high", confidence: "medium", message: "Bad." }] }) });
  assert.ok(body.startsWith(marker(base.sha, 2)));
  assert.match(body, /\*\*high\*\* \(confidence: medium\) `src\/a\.js:2`: Bad\./);
  assert.match(body, /tokens in\/out 1000\/50/);
  assert.match(body, /est\. cost \$0\.0123/);
  assert.match(body, /run 2 for this pull request/);
  const empty = render({ ...base, review: review() });
  assert.match(empty, /not a guarantee/);
});

test("render: 'unknown' says so and is not a verdict", () => {
  const body = render({ ...base, review: review({ result: "unknown", reason: "Too little context." }) });
  assert.match(body, /I do not know/);
  assert.match(body, /Too little context\./);
  assert.match(body, /Nothing here is a verdict/);
});

test("render: dropped findings and skipped files are disclosed", () => {
  const body = render({ ...base, redacted: 2, skipped: [{ filename: "big.js", reason: "over the input token budget" }], review: review({ dropped: 3 }) });
  assert.match(body, /3 findings dropped/);
  assert.match(body, /Not reviewed/);
  assert.match(body, /`big\.js`: over the input token budget/);
  assert.match(body, /2 secret-like strings removed/);
});

test("render: no usage or cost is left out, backticks in names cannot break the formatting", () => {
  const body = render({ ...base, usage: null, costUsd: null, skipped: [{ filename: "a`b.js", reason: "r" }], review: review() });
  assert.ok(!body.includes("tokens in/out"));
  assert.ok(!body.includes("est. cost"));
  assert.ok(body.includes("`a'b.js`"));
});

test("render: long skipped lists are cut", () => {
  const skipped = Array.from({ length: 40 }, (_, i) => ({ filename: `f${i}.js`, reason: "r" }));
  assert.match(render({ ...base, skipped, review: review() }), /and 10 more/);
});
