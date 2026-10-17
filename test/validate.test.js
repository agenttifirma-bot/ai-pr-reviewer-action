import assert from "node:assert/strict";
import test from "node:test";
import { clean, extractJson, validate, ValidationError } from "../src/validate.js";

const allowed = () => new Map([["src/a.js", new Set([2, 3, 10])], ["src/b.js", new Set([1])]]);
const finding = (over = {}) => ({ file: "src/a.js", line: 2, severity: "high", confidence: "high", message: "Null deref.", ...over });

test("clean: removes links, html, images, mentions and control chars; caps length", () => {
  const t = clean("See https://evil.example/x and <img src=x onerror=1> [click](http://a.b) ![p](http://c.d) @octocat `rm -rf`\u0000‮", 500);
  assert.ok(!/https?:\/\//.test(t));
  assert.ok(!t.includes("<img"));
  assert.ok(!t.includes("](") );
  assert.ok(!t.includes("@octocat"));
  assert.ok(!t.includes("`"));
  assert.ok(!/[\u0000‮]/.test(t));
  assert.equal(clean("x".repeat(1000), 50).length, 50);
});

test("extractJson: plain, fenced, and failures", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('Here:\n```json\n{"a":1}\n```'), { a: 1 });
  for (const bad of ["no json here", "{broken", 42]) {
    assert.throws(() => extractJson(bad), ValidationError);
  }
});

test("validate: keeps findings on lines that were shown, drops everything else and counts it", () => {
  const raw = { result: "ok", summary: "S", findings: [
    finding(),
    finding({ line: 99 }),                    // not an added line
    finding({ file: "src/other.js" }),        // not a reviewed file
    finding({ severity: "critical" }),        // unknown enum
    finding({ confidence: "low" }),           // unknown enum
    finding({ line: "2" }),                   // not an integer
    finding({ message: "   " }),              // empty after cleaning
    null, "string",
  ] };
  const v = validate(raw, allowed());
  assert.equal(v.findings.length, 1);
  assert.equal(v.dropped, 8);
});

test("validate: duplicates collapse, order is severity then file then line, max 10", () => {
  const many = Array.from({ length: 15 }, (_, i) => finding({ line: i < 3 ? [2, 3, 10][i] : 2, message: `m${i}` }));
  const v = validate({ result: "ok", summary: "", findings: [finding(), finding(), finding({ severity: "low", line: 3, message: "Other." }), finding({ severity: "high", line: 3 }), finding({ severity: "low", line: 3 })] }, allowed());
  assert.deepEqual(v.findings.map((f) => `${f.severity}:${f.line}`), ["high:2", "high:3", "low:3"]);
  assert.equal(v.findings[2].message, "Other.");   // the low copy of the high finding collapsed into it
  const big = validate({ result: "ok", summary: "", findings: many }, allowed());
  assert.ok(big.findings.length <= 10);
  const mixed = Array.from({ length: 12 }, (_, i) => finding({ severity: i === 11 ? "high" : "low", line: 2, message: `m${i}` }));
  const kept = validate({ result: "ok", summary: "", findings: mixed }, allowed());
  assert.equal(kept.findings.length, 10);
  assert.equal(kept.findings[0].severity, "high");   // the cap keeps the most severe, not the first listed
  assert.equal(kept.dropped, 2);
});

test("validate: 'unknown' is a first-class answer and carries a cleaned reason", () => {
  const v = validate({ result: "unknown", reason: "Too little context <b>x</b> https://a.b" }, allowed());
  assert.equal(v.result, "unknown");
  assert.equal(v.findings.length, 0);
  assert.ok(!v.reason.includes("<b>"));
  assert.equal(validate({ result: "unknown" }, allowed()).reason, "no reason given");
});

test("validate: findings are ignored when the model says unknown", () => {
  const v = validate({ result: "unknown", reason: "r", findings: [finding()] }, allowed());
  assert.equal(v.findings.length, 0);
});

test("validate: anything that is not the agreed shape throws", () => {
  for (const bad of [null, [], "x", { result: "maybe" }, {}]) {
    assert.throws(() => validate(bad, allowed()), ValidationError);
  }
});

test("validate: missing findings array is an empty, valid result", () => {
  const v = validate({ result: "ok", summary: "fine" }, allowed());
  assert.deepEqual(v.findings, []);
  assert.equal(v.summary, "fine");
});
