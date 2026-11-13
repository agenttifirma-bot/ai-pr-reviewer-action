// Unified-diff helpers. Only ADDED lines can carry a finding: the model may not point at code it was not shown.

/** @returns {Set<number>} new-file line numbers of added lines in a GitHub "patch" string */
export function addedLines(patch) {
  const added = new Set();
  if (typeof patch !== "string") return added;
  let line = 0;
  let inHunk = false;
  for (const raw of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith("+")) {
      added.add(line);
      line += 1;
    } else if (raw.startsWith("-") || raw.startsWith("\\")) {
      // removed line or "\ No newline at end of file": new-file counter unchanged
    } else {
      line += 1; // context line
    }
  }
  return added;
}

const SKIP_PATH = /(^|\/)(\.env[^/]*|[^/]*\.(pem|key|p12|pfx|crt|cer)|id_(rsa|ed25519|ecdsa)[^/]*|credentials\.json|secrets\.ya?ml|\.npmrc|\.netrc|\.htpasswd|[^/]*\.(tfvars|tfstate|jks|keystore|p8|kdbx)|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|[^/]*\.min\.(js|css)|[^/]*\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|eot|mp[34]|mov))$/i;

/** Files that are never sent to the model: secrets-like, generated, binary. */
export function skipReason(file) {
  if (!file || typeof file.filename !== "string") return "invalid entry";
  if (SKIP_PATH.test(file.filename)) return "excluded file type";
  if (file.status === "removed") return "file removed";
  if (typeof file.patch !== "string" || file.patch === "") return "no text diff (binary or too large)";
  return null;
}

/** Patch with new-file line numbers in front of added/context lines, so the model never has to count. */
export function numberedPatch(patch) {
  const out = [];
  let line = 0;
  let inHunk = false;
  for (const raw of String(patch).split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      inHunk = true;
      out.push(raw.replace(/\r$/, ""));
      continue;
    }
    if (!inHunk) continue;
    const text = raw.replace(/\r$/, "");
    if (text.startsWith("+")) {
      out.push(`${line}: ${text}`);
      line += 1;
    } else if (text.startsWith("-")) {
      out.push(`   ${text}`);
    } else if (text.startsWith("\\")) {
      continue;
    } else {
      out.push(`${line}: ${text}`);
      line += 1;
    }
  }
  return out.join("\n");
}

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Like numberedPatch, but with up to n unchanged lines of the file around every hunk, taken from fileText
 * (the file at the head commit). Context lines are wrapped in marker lines so they are clearly context.
 * Returns null when the context cannot be trusted: the file text does not match the patch lines
 * (e.g. the branch moved) or a hunk lies outside the file. The caller then uses the plain patch.
 * @returns {string | null}
 */
export function numberedPatchWithContext(patch, fileText, n, maxLineChars = 400) {
  if (!(n > 0)) return null;
  const lines = String(fileText).split("\n").map((l) => l.replace(/\r$/, ""));
  if (lines[lines.length - 1] === "") lines.pop();
  const total = lines.length;
  const hunks = [];
  for (const raw of String(patch).split("\n")) {
    const m = HUNK.exec(raw);
    if (m) {
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      // count 0 (pure deletion): the new range is empty and sits after line `start`
      hunks.push({ rows: [raw], first: count === 0 ? start + 1 : start, last: start + count - 1 });
    } else if (hunks.length) hunks.at(-1).rows.push(raw);
  }
  if (hunks.length === 0) return null;
  // The patch lines must be the file lines at the stated numbers, otherwise the context would be from another version.
  for (const h of hunks) {
    let line = h.first;
    for (const raw of h.rows.slice(1)) {
      const t = raw.replace(/\r$/, "");
      if (t.startsWith("-") || t.startsWith("\\")) continue;
      if (lines[line - 1] !== t.slice(1)) return null;
      line += 1;
    }
    if (h.last > total) return null;
  }
  const show = (from, to) => {
    if (from > to) return [];
    const out = ["[unchanged lines from the head commit, context only]"];
    for (let i = from; i <= to; i++) out.push(`${i}:  ${lines[i - 1].slice(0, maxLineChars)}`);
    out.push("[end context]");
    return out;
  };
  const out = [];
  let shownUpTo = 0;
  hunks.forEach((h, i) => {
    out.push(...show(Math.max(h.first - n, 1, shownUpTo + 1), h.first - 1));
    out.push(numberedPatch(h.rows.join("\n")));
    const afterTo = Math.min(h.last + n, total, i + 1 < hunks.length ? hunks[i + 1].first - 1 : total);
    out.push(...show(h.last + 1, afterTo));
    shownUpTo = Math.max(h.last, afterTo);
  });
  return out.join("\n");
}
