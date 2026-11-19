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
  [/\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi, "Bearer [REDACTED]"],
];
// Assignments are found in two linear steps. PREFIX matches only `name<quote?><sep><quote?>` and the callback
// checks the name against SECRET_WORD. Only for secret names is the value read (VALUE, sticky), so a non-secret
// name never swallows a later secret assignment (`user=bob&token=abcdef123`). Putting the keyword inside one
// regex between two [A-Za-z0-9_]* runs backtracks quadratically on long key-like words.
const PREFIX = /\b([A-Za-z0-9_]+)(["']?)(\s*[:=]\s*)(["']?)/g;
const VALUE = /[^\s"',;]{6,}/y;
const SECRET_WORD = /key|token|secret|password|passwd|pwd/i;

function redactAssignments(input, onHit) {
  let out = "";
  let last = 0;
  PREFIX.lastIndex = 0;
  let m;
  while ((m = PREFIX.exec(input)) !== null) {
    const [prefix, name, nameQ, sep, q] = m;
    const valueStart = m.index + prefix.length;
    if (!SECRET_WORD.test(name)) continue; // resume right after the prefix, so the value is scanned again
    VALUE.lastIndex = valueStart;
    const v = VALUE.exec(input);
    if (!v) continue;
    const end = valueStart + v[0].length;
    if (q && input[end] !== q) continue;
    if (v[0].startsWith("[REDACTED")) continue;
    onHit();
    out += input.slice(last, m.index) + `${name}${nameQ}${sep}${q}[REDACTED]${q}`;
    last = end + q.length;
    PREFIX.lastIndex = last;
  }
  return out + input.slice(last);
}

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
  out = redactAssignments(out, () => {
    count += 1;
  });
  return { text: out, count };
}
