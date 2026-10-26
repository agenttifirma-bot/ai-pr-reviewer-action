import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { cost, select } from "./budget.js";
import { addedLines, numberedPatch, skipReason } from "./diff.js";
import { client, GitHubError } from "./github.js";
import { DEFAULTS, HARD_CAPS } from "./limits.js";
import { chat, LLMError } from "./llm.js";
import { buildUserMessage, SYSTEM_PROMPT } from "./prompt.js";
import { redact } from "./redact.js";
import { marker, parseMarker, render } from "./render.js";
import { extractJson, validate, ValidationError } from "./validate.js";

export class ConfigError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const input = (env, name) => (env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
const intInput = (env, name, def, cap) => {
  const v = Number(input(env, name));
  return Number.isInteger(v) && v > 0 ? Math.min(v, cap) : def;
};
const priceInput = (env, name) => {
  const v = Number(input(env, name));
  return Number.isFinite(v) && v > 0 ? v : 0;
};

export async function run({ env = process.env, fetchImpl = fetch, log = console } = {}) {
  const notice = (m) => log.log(`::notice::${m}`);
  if (env.GITHUB_EVENT_NAME !== "pull_request") {
    throw new ConfigError(env.GITHUB_EVENT_NAME === "pull_request_target"
      ? "pull_request_target_refused: this Action reviews untrusted PR text and must not run with secrets from a fork. Use the pull_request trigger."
      : "unsupported_event: use the pull_request trigger");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY ?? "")) throw new ConfigError("bad_repository");
  const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
  let event;
  try {
    event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  } catch {
    throw new ConfigError("bad_event_payload");
  }
  const number = event?.pull_request?.number;
  const sha = event?.pull_request?.head?.sha;
  if (!Number.isInteger(number) || number < 1 || !/^[0-9a-f]{7,40}$/.test(sha ?? "")) throw new ConfigError("bad_event_payload");

  const apiKey = input(env, "api-key");
  if (!apiKey) {
    notice("No api-key available (normal for pull requests from forks): skipping, nothing was sent anywhere.");
    return { outcome: "skipped_no_key" };
  }
  const baseUrl = input(env, "base-url");
  const model = input(env, "model");
  if (!baseUrl || !model) throw new ConfigError("base_url_and_model_required");
  const maxInputTokens = intInput(env, "max-input-tokens", DEFAULTS.maxInputTokens, HARD_CAPS.maxInputTokens);
  const maxOutputTokens = intInput(env, "max-output-tokens", DEFAULTS.maxOutputTokens, HARD_CAPS.maxOutputTokens);
  const maxRuns = intInput(env, "max-runs-per-pr", DEFAULTS.maxRunsPerPr, HARD_CAPS.maxRunsPerPr);
  const dryRun = input(env, "dry-run") === "true";

  const gh = client({ token: input(env, "github-token") || env.GITHUB_TOKEN, apiUrl: env.GITHUB_API_URL || "https://api.github.com", fetchImpl });
  const mine = (await gh.listBotComments(owner, repo, number))
    .filter((c) => parseMarker(c.body))
    .sort((a, b) => b.id - a.id)[0];
  const prev = mine ? parseMarker(mine.body) : null;
  if (prev && prev.sha === sha) {
    notice("This commit was already reviewed: skipping.");
    return { outcome: "skipped_same_sha" };
  }
  if (prev && prev.runs >= maxRuns) {
    notice(`Run limit for this pull request reached (${maxRuns}): skipping.`);
    return { outcome: "skipped_run_limit" };
  }
  const runs = (prev?.runs ?? 0) + 1;

  const { files, truncated } = await gh.listFiles(owner, repo, number);
  const skipped = [];
  const candidates = [];
  for (const f of files) {
    const why = skipReason(f);
    if (why) {
      skipped.push({ filename: String(f?.filename ?? "?"), reason: why });
      continue;
    }
    candidates.push({ filename: f.filename, patch: f.patch });
  }
  if (truncated) skipped.push({ filename: "(files beyond the first 300)", reason: "GitHub API list limit" });
  const prepared = candidates.map((c) => ({ filename: c.filename, numbered: numberedPatch(c.patch), added: addedLines(c.patch) }));
  const picked = select(prepared.map((p) => ({ filename: p.filename, text: p.numbered })), maxInputTokens);
  skipped.push(...picked.skipped);
  if (picked.kept.length === 0) {
    notice("Nothing reviewable in this pull request: no model call was made.");
    return { outcome: "skipped_nothing_to_review" };
  }
  let redacted = 0;
  const allowed = new Map();
  const toSend = picked.kept.map((k) => {
    const p = prepared.find((x) => x.filename === k.filename);
    const r = redact(p.numbered);
    redacted += r.count;
    allowed.set(p.filename, p.added);
    return { filename: p.filename, numbered: r.text };
  });

  const reply = await chat({
    baseUrl, apiKey, model, fetchImpl,
    system: SYSTEM_PROMPT,
    user: buildUserMessage(String(event.pull_request.title ?? ""), toSend),
    maxOutputTokens,
  });
  const review = validate(extractJson(reply.content), allowed);
  const usage = reply.usage;
  const costUsd = cost(usage?.input ?? picked.inputTokens, usage?.output ?? maxOutputTokens, priceInput(env, "price-in"), priceInput(env, "price-out"));
  const body = render({ review, sha, runs, skipped, redacted, usage, costUsd, model, reviewedFiles: toSend.length });
  if (dryRun) {
    log.log(body);
    return { outcome: "dry_run", body, review };
  }
  if (mine) await gh.update(owner, repo, mine.id, body);
  else await gh.create(owner, repo, number, body);
  return { outcome: "reviewed", review, findings: review.findings.length };
}

export async function main(env = process.env) {
  try {
    const r = await run({ env });
    console.log(`::notice::ai-pr-reviewer: ${r.outcome}`);
    return 0;
  } catch (e) {
    const code = e?.code ?? "unexpected_error";
    if (e instanceof ConfigError) {
      console.log(`::error::ai-pr-reviewer: ${e.message}`);
      return 1;
    }
    const known = e instanceof LLMError || e instanceof GitHubError || e instanceof ValidationError;
    console.log(`::warning::ai-pr-reviewer: ${known ? code : "unexpected_error"}; no review posted`);
    return input(env, "fail-on-error") === "true" ? 1 : 0;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((c) => { process.exitCode = c; });
}
