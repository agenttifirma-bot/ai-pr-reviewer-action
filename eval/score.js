// Scoring: the reviewer's findings are compared with the expected ones. Mechanical (file + line + keyword), not a model judgement.
import { LINE_TOLERANCE } from "./cases.js";

/** Does a finding hit an expected one: same file, line within tolerance, a keyword in the message. */
export function matches(finding, want, tolerance = LINE_TOLERANCE) {
  if (finding.file !== want.file) return false;
  if (Math.abs(finding.line - want.line) > tolerance) return false;
  const message = String(finding.message ?? "").toLowerCase();
  return want.keywords.some((s) => message.includes(s.toLowerCase()));
}

/**
 * @param testCase a case from cases.js
 * @param result  {review: {result, findings, dropped}|null, error: string|null}
 * @returns {{id, clean, status, hits, missed, falseAlarms, duplicates, dropped}}
 *  status: "ok" | "unknown" | "error"
 *  falseAlarms: findings that hit no expected defect
 *  duplicates: a second finding on an already found defect (neither a false alarm nor a new hit)
 */
export function score(testCase, result) {
  const base = { id: testCase.id, clean: testCase.clean, expectedCount: testCase.expected.length, dropped: 0, duplicates: 0 };
  if (!result.review) return { ...base, status: "error", error: result.error ?? "error", hits: 0, missed: testCase.expected.length, falseAlarms: 0, falseAlarmFindings: [] };
  const r = result.review;
  if (r.result === "unknown") return { ...base, status: "unknown", hits: 0, missed: testCase.expected.length, falseAlarms: 0, falseAlarmFindings: [] };
  const found = new Set();
  let duplicates = 0;
  const falseAlarmFindings = [];
  for (const f of r.findings) {
    const i = testCase.expected.findIndex((o, j) => !found.has(j) && matches(f, o));
    if (i >= 0) {
      found.add(i);
      continue;
    }
    if (testCase.expected.some((o) => matches(f, o))) duplicates += 1;
    else falseAlarmFindings.push(`${f.file}:${f.line}`);
  }
  return {
    ...base, status: "ok", dropped: r.dropped ?? 0, duplicates,
    hits: found.size, missed: testCase.expected.length - found.size,
    falseAlarms: falseAlarmFindings.length, falseAlarmFindings,
  };
}

const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);

/** Totals over the case rows. */
export function summary(rows) {
  const sum = (k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
  const hits = sum("hits");
  const expectedCount = sum("expectedCount");
  const falseAlarms = sum("falseAlarms");
  const cleanRows = rows.filter((r) => r.clean);
  const cleanSilent = cleanRows.filter((r) => r.status !== "error" && r.falseAlarms === 0).length;
  return {
    cases: rows.length,
    expectedCount,
    hits,
    missed: sum("missed"),
    false_alarms: falseAlarms,
    duplicates: sum("duplicates"),
    dropped: sum("dropped"),
    unknown: rows.filter((r) => r.status === "unknown").length,
    errors: rows.filter((r) => r.status === "error").length,
    recall: ratio(hits, expectedCount),            // recall: found / expected defects
    precision: ratio(hits, hits + falseAlarms),        // precision: hits / (hits + falseAlarms halytykset)
    clean_silent: `${cleanSilent}/${cleanRows.length}`, // clean diffs without a single false alarm
  };
}
