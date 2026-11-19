// Stub models: plain code, not language models. Their results must NOT be presented as model results.
//  reference      returns the expected findings as they are: proves the pipeline and the scorer give 100 %.
//  rule-baseline  a few regular expressions over the added lines: a repeatable baseline a model has to beat.

/** Added lines from the message sent to the model: [{file, line, code}]. */
export function extractAddedLines(user) {
  const out = [];
  let file = null;
  for (const r of user.split("\n")) {
    const f = /^=== FILE: (\S+) ===$/.exec(r);
    if (f) {
      file = f[1];
      continue;
    }
    const m = /^(\d+): \+(.*)$/.exec(r);
    if (m && file) out.push({ file, line: Number(m[1]), code: m[2] });
  }
  return out;
}

const RULES = [
  [/\b(SELECT|INSERT|UPDATE|DELETE)\b.*("\s*\+|\+\s*"|\$\{)/i, "high", "SQL query is built by string concatenation: SQL injection."],
  [/\b(exec|execSync|spawnSync)\s*\(.*(\$\{|"\s*\+)|os\.system\(|shell\s*=\s*True/, "high", "Shell command is built from input: command injection."],
  [/<=\s*[\w.]+\.length\b/, "medium", "Loop bound uses <= length: off-by-one, reads past the end."],
  [/^\s*except\s*:/, "medium", "Bare except swallows every error."],
  [/^\s*def \w+\(.*=\s*(\[\]|\{\})/, "medium", "Mutable default argument is shared between calls."],
  [/\bif\s*\(\s*[\w.]+\s*=\s*[^=]/, "high", "Assignment inside a condition; comparison (===) was probably meant."],
  [/\beval\s*\(/, "high", "eval() on input allows arbitrary code execution."],
];

/** Rule-based baseline: does not see the case's expected findings, only the message sent to the model. */
export function ruleBaseline(body) {
  const findings = [];
  for (const r of extractAddedLines(body.messages[1].content)) {
    for (const [re, severity, message] of RULES) {
      if (re.test(r.code)) {
        findings.push({ file: r.file, line: r.line, severity, confidence: "medium", message });
        break;
      }
    }
  }
  return JSON.stringify({ result: "ok", analysis: "rule-based baseline", summary: `${findings.length} rule match(es).`, findings });
}

/** Upper bound: uses the case's expected findings (cheats on purpose). Only for verifying the pipeline and the scorer. */
export function reference(body, testCase) {
  const findings = testCase.expected.map((o) => ({ file: o.file, line: o.line, severity: "high", confidence: "high", message: `Reference finding: ${o.keywords[0]}.` }));
  return JSON.stringify({ result: "ok", analysis: "reference", summary: "Reference answer.", findings });
}

export const STUB_MODELS = { "rule-baseline": ruleBaseline, reference };
