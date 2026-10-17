import assert from "node:assert/strict";
import test from "node:test";
import { cost, estimateTokens, select } from "../src/budget.js";
import { PROMPT_OVERHEAD_TOKENS } from "../src/limits.js";

const f = (filename, n) => ({ filename, text: "x".repeat(n) });

test("estimateTokens is conservative (3 chars per token, rounded up)", () => {
  assert.equal(estimateTokens(300), 100);
  assert.equal(estimateTokens(301), 101);
});

test("select keeps small files first and reports every skipped file with a reason", () => {
  const r = select([f("big.js", 30000), f("a.js", 300), f("b.js", 600)], PROMPT_OVERHEAD_TOKENS + 400);
  assert.deepEqual(r.kept.map((x) => x.filename), ["a.js", "b.js"]);
  assert.deepEqual(r.skipped.map((x) => x.filename), ["big.js"]);
  assert.match(r.skipped[0].reason, /budget/);
  assert.ok(r.inputTokens <= PROMPT_OVERHEAD_TOKENS + 400);
});

test("select never exceeds the ceiling and can keep nothing", () => {
  const r = select([f("a.js", 3000)], PROMPT_OVERHEAD_TOKENS + 10);
  assert.equal(r.kept.length, 0);
  assert.equal(r.skipped.length, 1);
});

test("select is deterministic: ties are broken by name", () => {
  const r = select([f("b.js", 300), f("a.js", 300)], PROMPT_OVERHEAD_TOKENS + 300);
  assert.deepEqual(r.kept.map((x) => x.filename), ["a.js", "b.js"]);
});

test("cost: null without prices, exact with prices", () => {
  assert.equal(cost(1000, 1000, 0, 0), null);
  assert.equal(cost(1_000_000, 500_000, 2, 10), 7);
  assert.equal(cost(1_000_000, 1_000_000, 1, 0), 1);
});

test("select prefers many small files over one big one, whatever the names are", () => {
  const r = select([f("a.js", 900), f("b.js", 300), f("c.js", 300)], PROMPT_OVERHEAD_TOKENS + 340);
  assert.deepEqual(r.kept.map((x) => x.filename), ["b.js", "c.js"]);
  assert.deepEqual(r.skipped.map((x) => x.filename), ["a.js"]);
});
