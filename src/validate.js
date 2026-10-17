import { CONFIDENCES, MAX_FINDINGS, MAX_MESSAGE_CHARS, MAX_REASON_CHARS, MAX_SUMMARY_CHARS, SEVERITIES } from "./limits.js";

export class ValidationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** Text that came from the model is never trusted as markup: no links, HTML, images or @mentions. */
export function clean(text, max) {
  let t = String(text ?? "");
  t = t.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]+/g, " ");
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/<[^>]*>/g, " ");
  t = t.replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link removed]");
  t = t.replace(/@(?=\w)/g, "@\u200b");
  t = t.replace(/`/g, "'");
  return t.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Pulls the JSON object out of a model reply (plain, or inside a code fence). */
export function extractJson(content) {
  if (typeof content !== "string") throw new ValidationError("model_reply_not_text");
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ValidationError("model_reply_no_json");
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    throw new ValidationError("model_reply_bad_json");
  }
}

/**
 * @param {unknown} raw parsed model reply
 * @param {Map<string, Set<number>>} allowed file -> added line numbers that were actually shown
 * @returns {{result: "ok"|"unknown", summary: string, reason: string, findings: object[], dropped: number}}
 */
export function validate(raw, allowed) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ValidationError("reply_not_object");
  if (raw.result !== "ok" && raw.result !== "unknown") throw new ValidationError("reply_bad_result");
  if (raw.result === "unknown") {
    return { result: "unknown", summary: "", reason: clean(raw.reason, MAX_REASON_CHARS) || "no reason given", findings: [], dropped: 0 };
  }
  const list = Array.isArray(raw.findings) ? raw.findings : [];
  const valid = [];
  let dropped = 0;
  for (const f of list) {
    const lines = f && typeof f === "object" ? allowed.get(f.file) : undefined;
    const ok = lines
      && Number.isInteger(f.line) && lines.has(f.line)
      && SEVERITIES.includes(f.severity) && CONFIDENCES.includes(f.confidence)
      && typeof f.message === "string" && clean(f.message, MAX_MESSAGE_CHARS) !== "";
    if (!ok) {
      dropped += 1;
      continue;
    }
    valid.push({ file: f.file, line: f.line, severity: f.severity, confidence: f.confidence, message: clean(f.message, MAX_MESSAGE_CHARS) });
  }
  const order = { high: 0, medium: 1, low: 2 };
  valid.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);
  // duplicates collapse after sorting, so the most severe copy survives; the cap then keeps the most severe findings
  const seen = new Set();
  const findings = [];
  for (const f of valid) {
    const key = `${f.file}:${f.line}:${f.message.slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (findings.length >= MAX_FINDINGS) {
      dropped += 1;
      continue;
    }
    findings.push(f);
  }
  return { result: "ok", summary: clean(raw.summary, MAX_SUMMARY_CHARS), reason: "", findings, dropped };
}
