import assert from "node:assert/strict";
import test from "node:test";
import { redact } from "../src/redact.js";

test("redacts well-known token formats and counts them", () => {
  const samples = [
    "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
    "github_pat_" + "11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz",
    "sk-" + "abcdefghijklmnopqrstuvwxyz0123",
    "AKIA" + "ABCDEFGHIJKLMNOP",
    "xoxb-" + "1234567890-abcdefghij",
    "123456789:" + "ABCdefGHIjklMNOpqrSTUvwxYZ0123456789",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
  ];
  for (const s of samples) {
    const r = redact(`before ${s} after`);
    assert.ok(r.count >= 1, s);
    assert.ok(!r.text.includes(s.slice(-12)), s);
    assert.ok(r.text.startsWith("before ") && r.text.endsWith(" after"));
  }
});

test("redacts private key blocks across lines", () => {
  const r = redact("x\n-----BEGIN RSA PRIVATE KEY-----\nMIIabc\ndef\n-----END RSA PRIVATE KEY-----\ny");
  assert.equal(r.count, 1);
  assert.ok(!r.text.includes("MIIabc"));
});

test("redacts values of key/token/secret/password assignments but keeps the name", () => {
  const r = redact('const API_KEY = "supersecretvalue123";\npassword: hunter2hunter2\nconst monkey = 1;');
  assert.match(r.text, /API_KEY = "\[REDACTED\]"/);
  assert.match(r.text, /password: \[REDACTED\]/);
  assert.ok(!r.text.includes("supersecretvalue123"));
  assert.ok(!r.text.includes("hunter2hunter2"));
  assert.ok(r.text.includes("const monkey = 1;"));
});

test("leaves ordinary code alone", () => {
  const code = "function add(a, b) { return a + b; }\nconst n = items.map((i) => i.id);";
  const r = redact(code);
  assert.equal(r.text, code);
  assert.equal(r.count, 0);
});

test("a value already redacted by a token rule is not counted or relabelled twice", () => {
  for (const code of ['const API_KEY = "sk-' + 'abcdefghijklmnopqrstuvwxyz0123";', "API_KEY=sk-" + "abcdefghijklmnopqrstuvwxyz0123"]) {
    const r = redact(code);
    assert.equal(r.count, 1, code);
    assert.match(r.text, /\[REDACTED api key\]/);
    assert.ok(!r.text.includes("api key] "), code);
  }
});
