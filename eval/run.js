#!/usr/bin/env node
// Quality metric: runs the cases through the real run() path (GitHub replaced by a fake) and counts hits and false alarms.
//
//   node eval/run.js                                   replay: every eval/cassettes/*.json, no network, no cost
//   node eval/run.js --cassette eval/cassettes/X.json [--strict]
//   node eval/run.js --record --stub rule-baseline|reference
//   LLM_API_KEY=... node eval/run.js --record --base-url https://.../v1 --model NAME [--out eval/cassettes/NAME.json]
//
// A cassette stores the model's raw reply and a hash of the request (system + user message). If the prompt or
// the case changes, the hash no longer matches and the case is marked stale: it is not scored.
// Live recording: hard ceiling MAX_CALLS, the key is never printed or stored, errors print only the type.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { run } from "../src/index.js";
import { DEFAULTS } from "../src/limits.js";
import { checkBaseUrl } from "../src/llm.js";
import { SYSTEM_PROMPT } from "../src/prompt.js";
import { baseEnv, eventFile, fakeNet } from "../test/helpers.js";
import { STUB_MODELS } from "./stub-models.js";
import { score, summary } from "./score.js";
import { CASES } from "./cases.js";

export const MAX_CALLS = 40;          // hard ceiling for one live recording
export const CASSETTE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "cassettes");
const FAKE_BASE = "https://llm.example/v1";

/** Usage error: the message is a fixed string (no input, no secrets), so it is safe to print. */
class UsageError extends Error {}

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
/** Request hash: the model name does not matter (the same cassette can be replayed), the system and user messages do. */
export const requestHash = (body) => sha256(`${body.messages[0].content}\n\u0000\n${body.messages[1].content}`);

/**
 * Runs one case through the run() path.
 * answer(body) -> {content} | {missing: true}  (replay and stub), or live = {base, apiKey}.
 * @returns {{review, error, raw, hash, usage}}
 */
export async function runCase(testCase, { model, answer, live }) {
  let raw = null;
  let hash = null;
  let usage = null;
  let missing = false;
  const net = fakeNet({
    files: testCase.files,
    reply: (body) => {
      hash = requestHash(body);
      const v = answer(body);
      if (v.missing) missing = true;
      raw = v.content ?? "";
      return raw;
    },
  });
  const llmBase = live?.base ?? FAKE_BASE;
  const env = baseEnv({
    GITHUB_EVENT_PATH: eventFile({ title: testCase.title }),
    "INPUT_BASE-URL": llmBase,
    INPUT_MODEL: model,
    "INPUT_DRY-RUN": "true",
    ...(live ? { "INPUT_API-KEY": live.apiKey } : {}),
  });
  const fetchImpl = live
    ? async (url, init) => {
        if (!String(url).startsWith(`${llmBase}/`)) return net.fetchImpl(url, init);
        hash = requestHash(JSON.parse(init.body));
        const res = await fetch(url, init);
        try {
          const data = await res.clone().json();
          raw = data?.choices?.[0]?.message?.content ?? null;
          const u = data?.usage;
          if (u && Number.isFinite(u.prompt_tokens)) usage = { input: u.prompt_tokens, output: u.completion_tokens };
        } catch { raw = null; }
        return res;
      }
    : net.fetchImpl;
  let review = null;
  let error = null;
  try {
    const r = await run({ env, fetchImpl, log: { log() {} } });
    review = r.review ?? null;
    if (!review) error = r.outcome;
  } catch (e) {
    error = e?.code ?? e?.constructor?.name ?? "error"; // type/code only, no message
  }
  if (missing) return { review: null, error: "cassette_missing", raw: null, hash, usage };
  return { review, error, raw, hash, usage };
}

/** Replays a cassette: returns the case rows and the summary. Stale and missing cases are left out of the score. */
export async function replay(cassette, cases = CASES) {
  const rows = [];
  const staleCases = [];
  const missingCases = [];
  for (const t of cases) {
    const n = cassette.replies?.[t.id];
    if (!n) {
      missingCases.push(t.id);
      continue;
    }
    let matchesHash = true;
    const result = await runCase(t, {
      model: cassette.model,
      answer: (body) => {
        matchesHash = requestHash(body) === n.request_sha256;
        return { content: n.content };
      },
    });
    if (!matchesHash) {
      staleCases.push(t.id);
      continue;
    }
    rows.push(score(t, result));
  }
  return { model: cassette.model, source: cassette.source, rows, staleCases, missingCases, summary: summary(rows) };
}

/** Records all cases with a stub model or against a live model. */
export async function record({ model, source, stub, live }, cases = CASES) {
  const replies = {};
  for (const t of cases) {
    const result = await runCase(t, {
      model,
      live,
      answer: stub ? (body) => ({ content: stub(body, t) }) : undefined,
    });
    if (result.hash == null) continue; // no model call (e.g. nothing to review)
    replies[t.id] = { request_sha256: result.hash, content: result.raw, usage: result.usage, ...(result.error ? { error: result.error } : {}) };
  }
  return {
    format: "aprr-eval-cassette/1",
    model, source,
    recorded: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    prompt_sha256: sha256(SYSTEM_PROMPT),
    max_output_tokens: DEFAULTS.maxOutputTokens,
    replies,
  };
}

export function table(t) {
  const out = ["| case | status | hits/expected | false alarms |", "|---|---|---|---|"];
  for (const r of t.rows) {
    out.push(`| ${r.id} | ${r.status}${r.error ? ` (${r.error})` : ""} | ${r.hits}/${r.expectedCount} | ${r.falseAlarms}${r.falseAlarmFindings?.length ? ` (${r.falseAlarmFindings.join(", ")})` : ""} |`);
  }
  return out.join("\n");
}

function args(argv) {
  const a = { cassettes: [] };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--cassette") a.cassettes.push(argv[++i]);
    else if (k === "--record") a.record = true;
    else if (k === "--stub") a.stub = argv[++i];
    else if (k === "--base-url") a.baseUrl = argv[++i];
    else if (k === "--model") a.model = argv[++i];
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--strict") a.strict = true;
    else if (k === "--json") a.json = true;
    else throw new UsageError("unknown option");
  }
  return a;
}

async function main() {
  const a = args(process.argv);
  if (a.record) {
    let cassette;
    if (a.stub) {
      const stubFn = STUB_MODELS[a.stub];
      if (!stubFn) throw new UsageError("unknown stub");
      cassette = await record({ model: `stub-${a.stub}`, source: "stub", stub: stubFn });
    } else {
      if (!a.baseUrl || !a.model) throw new UsageError("use --stub NAME or --base-url URL --model NAME");
      const apiKey = process.env.LLM_API_KEY ?? "";
      if (!apiKey) throw new UsageError("LLM_API_KEY is missing from the environment");
      if (CASES.length > MAX_CALLS) throw new UsageError("too many calls");
      cassette = await record({ model: a.model, source: "live", live: { base: checkBaseUrl(a.baseUrl), apiKey } });
    }
    const out = a.out ?? path.join(CASSETTE_DIR, `${cassette.model.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
    fs.writeFileSync(out, `${JSON.stringify(cassette, null, 1)}\n`);
    console.log(`recorded ${Object.keys(cassette.replies).length} replies: ${out}`);
    return 0;
  }
  const files = a.cassettes.length
    ? a.cassettes
    : fs.readdirSync(CASSETTE_DIR).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(CASSETTE_DIR, f));
  let problems = 0;
  const all = [];
  for (const f of files) {
    const t = await replay(JSON.parse(fs.readFileSync(f, "utf8")));
    problems += t.staleCases.length + t.missingCases.length;
    all.push(t);
    if (a.json) continue;
    console.log(`\n## ${t.model} (${t.source}; ${path.basename(f)})\n\n${table(t)}\n`);
    console.log(JSON.stringify(t.summary));
    if (t.staleCases.length) console.log(`stale (prompt or case changed, record again): ${t.staleCases.join(", ")}`);
    if (t.missingCases.length) console.log(`missing: ${t.missingCases.join(", ")}`);
  }
  if (a.json) console.log(JSON.stringify(all.map(({ model, source, summary: y, staleCases, missingCases }) => ({ model, source, ...y, staleCases, missingCases })), null, 1));
  return a.strict && problems > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((c) => { process.exitCode = c; }, (e) => { console.error(e instanceof UsageError ? `error: ${e.message}` : `error: ${e?.constructor?.name}`); process.exitCode = 1; });
}
