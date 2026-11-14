import assert from "node:assert/strict";
import test from "node:test";
import { redact } from "../src/redact.js";
import { marker, parseMarker, render } from "../src/render.js";

const SHA40 = "a".repeat(40);
const pad = (n) => "a".repeat(n);

// --- redact: assignment value length boundary (rule needs 6 or more characters) ---

test("redact: assignment values of 5 characters are kept, 6 characters are removed", () => {
  const five = redact("password=abcde");
  assert.equal(five.text, "password=abcde");
  assert.equal(five.count, 0);
  const six = redact("password=abcdef");
  assert.equal(six.text, "password=[REDACTED]");
  assert.equal(six.count, 1);
});

test("redact: an empty quoted value is not counted", () => {
  const r = redact('secretkey=""');
  assert.equal(r.text, 'secretkey=""');
  assert.equal(r.count, 0);
});

// --- redact: value terminators ---

test("redact: a value ending in ; or , keeps the terminator outside the redaction", () => {
  assert.equal(redact("password=abcdef;").text, "password=[REDACTED];");
  assert.equal(redact("password=abcdef,").text, "password=[REDACTED],");
  assert.equal(redact("token: abcdef,").text, "token: [REDACTED],");
  assert.equal(redact("password=abcdef;").count, 1);
});

test("redact: a value is only read up to the first ; so a short first part is not matched", () => {
  const r = redact("password=abc;def123");
  assert.equal(r.count, 0);
  assert.equal(r.text, "password=abc;def123");
});

test("redact: a value stops at the line end and the next line is untouched", () => {
  const r = redact("MY_SECRET_KEY=abcdef\nnext=1");
  assert.equal(r.text, "MY_SECRET_KEY=[REDACTED]\nnext=1");
  assert.equal(r.count, 1);
});

test("redact: spaces around the separator are allowed and kept", () => {
  assert.equal(redact("password : abcdef").text, "password : [REDACTED]");
});

test("redact: a value that already starts with [REDACTED is left alone", () => {
  const r = redact("password=[REDACTED x]");
  assert.equal(r.text, "password=[REDACTED x]");
  assert.equal(r.count, 0);
});

// --- redact: Bearer token padding and length ---

test("redact: Bearer needs 20 token characters", () => {
  const short = redact(`Bearer ${pad(19)}`);
  assert.equal(short.text, `Bearer ${pad(19)}`);
  assert.equal(short.count, 0);
  const ok = redact(`Bearer ${pad(20)}`);
  assert.equal(ok.text, "Bearer [REDACTED]");
  assert.equal(ok.count, 1);
});

test("redact: trailing = padding of a Bearer token is removed with it", () => {
  assert.equal(redact(`Bearer ${pad(20)}==`).text, "Bearer [REDACTED]");
});

test("redact: all allowed Bearer characters (. _ ~ + / - =) are covered, and a tab works as separator", () => {
  assert.equal(redact("Bearer a.b-c_d~e+f/g1234567890=").text, "Bearer [REDACTED]");
  assert.equal(redact(`Bearer\t${pad(20)}`).text, "Bearer [REDACTED]");
});

test("redact: a capitalised 'Bearer <token>' is always redacted", () => {
  const r = redact(`Bearer ${pad(20)}`);
  assert.equal(r.count, 1);
});

// --- redact: input types ---

test("redact: non-string input is converted to text and does not throw", () => {
  assert.deepEqual(redact(123), { text: "123", count: 0 });
  assert.deepEqual(redact(null), { text: "null", count: 0 });
  assert.deepEqual(redact(undefined), { text: "undefined", count: 0 });
  assert.deepEqual(redact(true), { text: "true", count: 0 });
  assert.deepEqual(redact(["a", "token=abcdef12"]), { text: "a,token=[REDACTED]", count: 1 });
});

// --- parseMarker: runs field and sha boundaries ---

test("parseMarker: runs accepts 1 to 3 digits (0 and 999 pass, 1000 does not)", () => {
  const m = (runs) => `<!-- ai-pr-reviewer:v1 sha=abcdef0 runs=${runs} -->`;
  assert.deepEqual(parseMarker(m(0)), { sha: "abcdef0", runs: 0 });
  assert.deepEqual(parseMarker(m(999)), { sha: "abcdef0", runs: 999 });
  assert.equal(parseMarker(m(1000)), null);
  assert.equal(parseMarker(m(-1)), null);
});

test("parseMarker: leading zeros in runs are read as a number", () => {
  assert.equal(parseMarker("<!-- ai-pr-reviewer:v1 sha=abcdef0 runs=007 -->").runs, 7);
});

test("parseMarker: sha must be 7 to 40 lowercase hex characters", () => {
  const m = (sha) => `<!-- ai-pr-reviewer:v1 sha=${sha} runs=1 -->`;
  assert.equal(parseMarker(m("abcdef")), null);
  assert.equal(parseMarker(m("abcdef0")).sha, "abcdef0");
  assert.equal(parseMarker(m(SHA40)).sha, SHA40);
  assert.equal(parseMarker(m("a".repeat(41))), null);
  assert.equal(parseMarker(m("ABCDEF0")), null);
});

test("parseMarker: the marker must be at the very start, text after it is allowed", () => {
  assert.equal(parseMarker("\n<!-- ai-pr-reviewer:v1 sha=abcdef0 runs=1 -->"), null);
  assert.deepEqual(parseMarker("<!-- ai-pr-reviewer:v1 sha=abcdef0 runs=1 --> trailing"), { sha: "abcdef0", runs: 1 });
});

test("parseMarker: non-string input gives null", () => {
  assert.equal(parseMarker({}), null);
  assert.equal(parseMarker(5), null);
});

test("render: the first line is a marker that parseMarker reads back", () => {
  const body = render({
    sha: SHA40, runs: 12, skipped: [], redacted: 0, usage: null, costUsd: null, model: "m", reviewedFiles: 1,
    review: { result: "ok", summary: "", reason: "", findings: [], dropped: 0 },
  });
  assert.equal(body.split("\n")[0], marker(SHA40, 12));
  assert.deepEqual(parseMarker(body), { sha: SHA40, runs: 12 });
});
