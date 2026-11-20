import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCase, replay, record, table } from "../eval/run.js";
import { STUB_MODELS } from "../eval/stub-models.js";
import { CASES } from "../eval/cases.js";

const RUN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "eval", "run.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aprr-eval-cli-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Runs eval/run.js in a child process with an EMPTY environment: no keys, no proxy settings. */
function cli(...args) {
  return spawnSync(process.execPath, [RUN, ...args], { cwd: tmp, env: {}, encoding: "utf8", timeout: 120_000 });
}

/** A valid stub cassette in the temp directory (the repo cassettes are never touched). */
async function writeCassette(name, edit = (c) => c) {
  const c = edit(await record({ model: "stub-test", source: "stub", stub: STUB_MODELS["rule-baseline"] }));
  const file = path.join(tmp, name);
  fs.writeFileSync(file, JSON.stringify(c));
  return file;
}

test("table: header, status, hits, false alarms and the error text", () => {
  const out = table({
    rows: [
      { id: "a", status: "ok", hits: 1, expectedCount: 2, falseAlarms: 0 },
      { id: "b", status: "error", error: "llm_http_500", hits: 0, expectedCount: 1, falseAlarms: 2, falseAlarmFindings: ["x.js:3", "y.js:4"] },
    ],
  }).split("\n");
  assert.equal(out[0], "| case | status | hits/expected | false alarms |");
  assert.equal(out[1], "|---|---|---|---|");
  assert.equal(out[2], "| a | ok | 1/2 | 0 |");
  assert.equal(out[3], "| b | error (llm_http_500) | 0/1 | 2 (x.js:3, y.js:4) |");
});

test("runCase: when run() throws, only the error code is returned, never the message", async () => {
  const r = await runCase({ title: "t", files: {} }, { model: "m", answer: () => ({ content: "x" }) });
  assert.equal(r.review, null);
  assert.equal(r.error, "github_bad_reply");
  assert.equal(r.hash, null);
});

test("runCase: a missing cassette answer is reported as cassette_missing", async () => {
  const r = await runCase(CASES[0], { model: "m", answer: () => ({ missing: true }) });
  assert.equal(r.error, "cassette_missing");
  assert.equal(r.review, null);
  assert.equal(r.raw, null);
  assert.match(r.hash, /^[0-9a-f]{64}$/);
});

test("replay: an empty cassette scores nothing and lists every case as missing", async () => {
  const t = await replay({ model: "empty", source: "stub", replies: {} });
  assert.deepEqual(t.rows, []);
  assert.deepEqual(t.staleCases, []);
  assert.deepEqual(t.missingCases, CASES.map((c) => c.id));
  const noReplies = await replay({ model: "none", source: "stub" });
  assert.equal(noReplies.missingCases.length, CASES.length);
});

test("cli: --cassette --json prints one summary per cassette and exits 0", async () => {
  const file = await writeCassette("ok.json");
  const r = cli("--cassette", file, "--json");
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.length, 1);
  assert.equal(data[0].model, "stub-test");
  assert.deepEqual(data[0].staleCases, []);
  assert.deepEqual(data[0].missingCases, []);
});

test("cli: without --json it prints the table and the summary line", async () => {
  const file = await writeCassette("table.json");
  const r = cli("--cassette", file);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^## stub-test \(stub; table\.json\)/m);
  assert.match(r.stdout, /\| case \| status \| hits\/expected \| false alarms \|/);
});

test("cli: without --cassette it replays every cassette in eval/cassettes", () => {
  const r = cli("--strict");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /## stub-reference/);
  assert.match(r.stdout, /## stub-rule-baseline/);
});

test("cli: missing cases are listed; --strict makes them exit code 1, otherwise 0", async () => {
  const file = await writeCassette("missing.json", (c) => { delete c.replies[CASES[0].id]; return c; });
  const lax = cli("--cassette", file);
  assert.equal(lax.status, 0);
  assert.match(lax.stdout, new RegExp(`missing: ${CASES[0].id}`));
  assert.equal(cli("--cassette", file, "--strict").status, 1);
  const json = JSON.parse(cli("--cassette", file, "--json").stdout);
  assert.deepEqual(json[0].missingCases, [CASES[0].id]);
});

test("cli: stale cases (request hash differs) are listed and left out of the score", async () => {
  const file = await writeCassette("stale.json", (c) => { c.replies[CASES[1].id].request_sha256 = "0".repeat(64); return c; });
  const lax = cli("--cassette", file);
  assert.equal(lax.status, 0);
  assert.match(lax.stdout, new RegExp(`stale \\(prompt or case changed, record again\\): ${CASES[1].id}`));
  assert.ok(!lax.stdout.includes(`| ${CASES[1].id} |`));
  assert.equal(cli("--cassette", file, "--strict").status, 1);
});

test("cli: an empty cassette with --strict exits 1 and lists all cases as missing", () => {
  const file = path.join(tmp, "empty.json");
  fs.writeFileSync(file, JSON.stringify({ model: "empty", source: "stub", replies: {} }));
  const r = cli("--cassette", file, "--strict");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /missing: /);
});

test("cli: an unknown option is a usage error with a fixed message", () => {
  const r = cli("--nonsense");
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim(), "error: unknown option");
});

test("cli: a non-usage error prints only the error type, not the message or the path", () => {
  const secretPath = path.join(tmp, "no-such-dir-xyzzy", "none.json");
  const r = cli("--cassette", secretPath);
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim(), "error: Error");
  assert.ok(!r.stderr.includes("xyzzy") && !r.stderr.includes("ENOENT"));
});

test("cli --record: usage errors for unknown stub, missing options and missing key (empty env, no network)", () => {
  assert.equal(cli("--record", "--stub", "nope").stderr.trim(), "error: unknown stub");
  assert.match(cli("--record").stderr, /error: use --stub NAME or --base-url URL --model NAME/);
  const nokey = cli("--record", "--base-url", "https://llm.example/v1", "--model", "m");
  assert.equal(nokey.status, 1);
  assert.match(nokey.stderr, /error: LLM_API_KEY is missing from the environment/);
});

test("cli --record --stub: writes a cassette to --out that replays without stale or missing cases", () => {
  const out = path.join(tmp, "recorded.json");
  const r = cli("--record", "--stub", "rule-baseline", "--out", out);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^recorded ${CASES.length} replies: `));
  const c = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(c.format, "aprr-eval-cassette/1");
  assert.equal(c.model, "stub-rule-baseline");
  const back = JSON.parse(cli("--cassette", out, "--json").stdout);
  assert.deepEqual([back[0].staleCases, back[0].missingCases], [[], []]);
});
