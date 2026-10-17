// Remove secret-looking strings from diff text BEFORE it leaves the runner. Best effort, not a guarantee:
// regexes miss formats. It is a second line of defence; the first is that the Action never checks out PR code.
const RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED private key]"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g, "[REDACTED github token]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED github token]"],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED api key]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED aws key id]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED slack token]"],
  [/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g, "[REDACTED bot token]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED jwt]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g, "Bearer [REDACTED]"],
];
const ASSIGNMENT = /\b([A-Za-z0-9_]*(?:key|token|secret|password|passwd|pwd)[A-Za-z0-9_]*)(\s*[:=]\s*)(["']?)([^\s"',;]{6,})\3/gi;

/** @returns {{text: string, count: number}} */
export function redact(text) {
  let count = 0;
  let out = String(text);
  for (const [re, label] of RULES) {
    out = out.replace(re, () => {
      count += 1;
      return label;
    });
  }
  out = out.replace(ASSIGNMENT, (m, name, sep, q, value) => {
    if (value.startsWith("[REDACTED")) return m;
    count += 1;
    return `${name}${sep}${q}[REDACTED]${q}`;
  });
  return { text: out, count };
}
