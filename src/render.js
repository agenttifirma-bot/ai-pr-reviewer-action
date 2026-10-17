const MARKER_RE = /^<!-- ai-pr-reviewer:v1 sha=([0-9a-f]{7,40}) runs=(\d{1,3}) -->/;

export function marker(sha, runs) {
  return `<!-- ai-pr-reviewer:v1 sha=${sha} runs=${runs} -->`;
}

export function parseMarker(body) {
  const m = typeof body === "string" ? MARKER_RE.exec(body) : null;
  return m ? { sha: m[1], runs: Number(m[2]) } : null;
}

const tick = (s) => String(s).replace(/`/g, "'");

/**
 * @param {object} r {review, sha, runs, skipped, redacted, usage, costUsd, model, reviewedFiles}
 */
export function render(r) {
  const out = [marker(r.sha, r.runs), "## Automated AI review (can be wrong)", ""];
  const v = r.review;
  if (v.result === "unknown") {
    out.push(`**I do not know.** ${v.reason}`, "", "Nothing here is a verdict on this pull request.");
  } else {
    if (v.summary) out.push(v.summary, "");
    if (v.findings.length === 0) {
      out.push("No issues found in the parts that were reviewed. That is not a guarantee: see \"Not reviewed\" below.");
    } else {
      out.push(`${v.findings.length} finding${v.findings.length === 1 ? "" : "s"}:`, "");
      for (const f of v.findings) {
        out.push(`- **${f.severity}** (confidence: ${f.confidence}) \`${tick(f.file)}:${f.line}\`: ${f.message}`);
      }
    }
    if (v.dropped > 0) out.push("", `${v.dropped} finding${v.dropped === 1 ? "" : "s"} dropped: location was not an added line that was shown to the model.`);
  }
  out.push("", `Reviewed ${r.reviewedFiles} file${r.reviewedFiles === 1 ? "" : "s"}.`);
  if (r.skipped.length > 0) {
    out.push("", "<details><summary>Not reviewed</summary>", "");
    for (const s of r.skipped.slice(0, 30)) out.push(`- \`${tick(s.filename)}\`: ${s.reason}`);
    if (r.skipped.length > 30) out.push(`- ... and ${r.skipped.length - 30} more`);
    out.push("", "</details>");
  }
  const foot = [`model \`${tick(r.model)}\``];
  if (r.usage) foot.push(`tokens in/out ${r.usage.input}/${r.usage.output}`);
  if (r.costUsd != null) foot.push(`est. cost $${r.costUsd.toFixed(4)}`);
  if (r.redacted > 0) foot.push(`${r.redacted} secret-like string${r.redacted === 1 ? "" : "s"} removed before sending`);
  foot.push(`run ${r.runs} for this pull request`);
  out.push("", `<sub>${foot.join(" · ")}</sub>`);
  return out.join("\n");
}
