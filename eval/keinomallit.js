// Keinomallit: koodia, ei kielimalleja. Niiden tuloksia EI saa esittaa mallien tuloksina.
//  viite       palauttaa odotetut loydokset sellaisenaan: todentaa, etta putki ja pisteytys antavat 100 %.
//  saantopohja muutama saannollinen lauseke lisatyille riveille: toistettava vertailutaso, joka mallin pitaa ylittaa.

/** Lisatyt rivit mallille menevasta viestista: [{file, line, code}]. */
export function lisatytRivit(user) {
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

const SAANNOT = [
  [/\b(SELECT|INSERT|UPDATE|DELETE)\b.*("\s*\+|\+\s*"|\$\{)/i, "high", "SQL query is built by string concatenation: SQL injection."],
  [/\b(exec|execSync|spawnSync)\s*\(.*(\$\{|"\s*\+)|os\.system\(|shell\s*=\s*True/, "high", "Shell command is built from input: command injection."],
  [/<=\s*[\w.]+\.length\b/, "medium", "Loop bound uses <= length: off-by-one, reads past the end."],
  [/^\s*except\s*:/, "medium", "Bare except swallows every error."],
  [/^\s*def \w+\(.*=\s*(\[\]|\{\})/, "medium", "Mutable default argument is shared between calls."],
  [/\bif\s*\(\s*[\w.]+\s*=\s*[^=]/, "high", "Assignment inside a condition; comparison (===) was probably meant."],
  [/\beval\s*\(/, "high", "eval() on input allows arbitrary code execution."],
];

/** Saantopohjainen vertailutaso: ei nae tapauksen odotettuja loydoksia, vain mallille menevan viestin. */
export function saantopohja(body) {
  const findings = [];
  for (const r of lisatytRivit(body.messages[1].content)) {
    for (const [re, severity, message] of SAANNOT) {
      if (re.test(r.code)) {
        findings.push({ file: r.file, line: r.line, severity, confidence: "medium", message });
        break;
      }
    }
  }
  return JSON.stringify({ result: "ok", analysis: "rule-based baseline", summary: `${findings.length} rule match(es).`, findings });
}

/** Ylaraja: kayttaa tapauksen odotettuja loydoksia (huijaa tarkoituksella). Vain putken ja pisteytyksen todennukseen. */
export function viite(body, tapaus) {
  const findings = tapaus.odotetut.map((o) => ({ file: o.file, line: o.line, severity: "high", confidence: "high", message: `Reference finding: ${o.avainsanat[0]}.` }));
  return JSON.stringify({ result: "ok", analysis: "reference", summary: "Reference answer.", findings });
}

export const KEINOMALLIT = { saantopohja, viite };
