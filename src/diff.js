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

const SKIP_PATH = /(^|\/)(\.env[^/]*|[^/]*\.(pem|key|p12|pfx|crt|cer)|id_(rsa|ed25519|ecdsa)[^/]*|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|[^/]*\.min\.(js|css)|[^/]*\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|eot|mp[34]|mov))$/i;

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
