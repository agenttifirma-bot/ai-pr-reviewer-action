// Cases for the quality metric: small, hand-written diffs with a known defect or with none.
// All code was written for this metric (not copied from other projects, no private code,
// no secrets). The file is ASCII.
//
// An expected finding = {file, line, keywords}. A finding counts as a hit when the file is the same, the line is
// at most LINE_TOLERANCE away and the message contains at least one of the keywords (lower case).

/**
 * Builds a GitHub "patch" string and computes the new line numbers of the defects.
 * @param {number} start first line number of the new file (new file: 1)
 * @param {(string|[string, string])[]} rows "+added", " context", "-removed"; [line, key] marks a defect
 * @param {boolean} isNew true = new file (@@ -0,0 ...)
 */
export function patch(start, rows, isNew = false) {
  let line = start;
  let oldCount = 0;
  let newCount = 0;
  const out = [];
  const defects = {};
  for (const x of rows) {
    const [r, key] = Array.isArray(x) ? x : [x];
    out.push(r);
    if (r.startsWith("-")) {
      oldCount += 1;
      continue;
    }
    if (key) defects[key] = line;
    if (r.startsWith(" ")) oldCount += 1;
    newCount += 1;
    line += 1;
  }
  const oldRange = isNew ? "-0,0" : `-${start},${oldCount}`;
  return { patch: `@@ ${oldRange} +${start},${newCount} @@\n${out.join("\n")}`, defects };
}

const newFile = (filename, rows) => {
  const p = patch(1, rows.map((r) => (Array.isArray(r) ? [`+${r[0]}`, r[1]] : `+${r}`)), true);
  return { file: { filename, status: "added", patch: p.patch }, defects: p.defects };
};
const modified = (filename, start, rows) => {
  const p = patch(start, rows);
  return { file: { filename, status: "modified", patch: p.patch }, defects: p.defects };
};

function makeCase({ id, description, title, parts, expected = [] }) {
  const defects = Object.assign({}, ...parts.map((o) => o.defects));
  return {
    id, description, title,
    files: parts.map((o) => o.file),
    clean: expected.length === 0,
    expected: expected.map((o) => {
      if (!(o.key in defects)) throw new Error(`case ${id}: unknown defect key ${o.key}`);
      return { file: o.file, line: defects[o.key], keywords: o.keywords };
    }),
  };
}

export const LINE_TOLERANCE = 1;

const SQL = ["sql", "injection", "concatenat", "parameter", "sanitiz", "escap"];
const COMMAND = ["command injection", "shell", "injection", "sanitiz", "escap"];
const OVERRUN = ["off-by-one", "off by one", "out of bounds", "out-of-bounds", "past the end", "undefined", "<=", "bound"];
const NULLISH = ["null", "undefined", "not found", "missing", "check"];

export const CASES = [
  makeCase({
    id: "defect-01-sql-concat", description: "SQL query is built by concatenating strings",
    title: "Add user lookup by email",
    parts: [newFile("src/users.js", [
      "export async function findByEmail(db, email) {",
      ["  const rows = await db.query(\"SELECT id, name FROM users WHERE email = '\" + email + \"'\");", "sql"],
      "  return rows[0] ?? null;",
      "}",
    ])],
    expected: [{ file: "src/users.js", key: "sql", keywords: SQL }],
  }),
  makeCase({
    id: "defect-02-loop-overrun", description: "Loop bound <= length reads past the end of the array",
    title: "Sum order totals",
    parts: [newFile("src/orders.js", [
      "export function total(orders) {",
      "  let sum = 0;",
      ["  for (let i = 0; i <= orders.length; i++) {", "overrun"],
      "    sum += orders[i].amount;",
      "  }",
      "  return sum;",
      "}",
    ])],
    expected: [{ file: "src/orders.js", key: "overrun", keywords: OVERRUN }],
  }),
  makeCase({
    id: "defect-03-null-check", description: "find() can return undefined, and a field of it is read",
    title: "Show the owner's display name",
    parts: [modified("src/projects.js", 10, [
      " export function ownerName(project, users) {",
      "-  return project.ownerName;",
      "+  const owner = users.find((u) => u.id === project.ownerId);",
      ["+  return owner.displayName;", "null"],
      " }",
    ])],
    expected: [{ file: "src/projects.js", key: "null", keywords: NULLISH }],
  }),
  makeCase({
    id: "defect-04-command-injection", description: "User input goes into a shell command",
    title: "Add archive endpoint",
    parts: [newFile("src/archive.js", [
      "import { execSync } from \"node:child_process\";",
      "",
      "export function archive(req, res) {",
      "  const name = req.query.name;",
      ["  execSync(`tar czf /tmp/${name}.tgz /srv/data/${name}`);", "cmd"],
      "  res.send(\"ok\");",
      "}",
    ])],
    expected: [{ file: "src/archive.js", key: "cmd", keywords: COMMAND }],
  }),
  makeCase({
    id: "defect-05-path-traversal", description: "A user-supplied file name is joined to a path without confinement",
    title: "Serve uploaded files",
    parts: [newFile("src/files.js", [
      "import fs from \"node:fs\";",
      "import path from \"node:path\";",
      "",
      "export function download(req, res) {",
      ["  const file = path.join(\"/srv/uploads\", req.params.name);", "path"],
      "  res.send(fs.readFileSync(file));",
      "}",
    ])],
    expected: [{ file: "src/files.js", key: "path", keywords: ["traversal", "../", "directory", "path", "sanitiz", "outside"] }],
  }),
  makeCase({
    id: "defect-06-missing-await", description: "An async call is not awaited, so its error and result are lost",
    title: "Save settings before redirect",
    parts: [modified("src/settings.js", 20, [
      " export async function saveAndGo(store, settings, go) {",
      ["+  store.save(settings);", "await"],
      "   go(\"/home\");",
      " }",
    ])],
    expected: [{ file: "src/settings.js", key: "await", keywords: ["await", "promise", "async", "race"] }],
  }),
  makeCase({
    id: "defect-07-py-mutable-default", description: "Python mutable default argument is shared between calls",
    title: "Collect tags",
    parts: [newFile("app/tags.py", [
      ["def add_tag(tag, tags=[]):", "default"],
      "    tags.append(tag)",
      "    return tags",
    ])],
    expected: [{ file: "app/tags.py", key: "default", keywords: ["mutable", "default", "shared"] }],
  }),
  makeCase({
    id: "defect-08-py-divide-by-zero", description: "An empty list causes division by zero",
    title: "Average response time",
    parts: [newFile("app/stats.py", [
      "def average(times):",
      ["    return sum(times) / len(times)", "division"],
    ])],
    expected: [{ file: "app/stats.py", key: "division", keywords: ["zero", "empty", "zerodivision"] }],
  }),
  makeCase({
    id: "defect-09-py-swallowed-errors", description: "Bare except swallows all errors and returns a wrong value",
    title: "Load config safely",
    parts: [newFile("app/config.py", [
      "import json",
      "",
      "def load(path):",
      "    try:",
      "        with open(path) as f:",
      "            return json.load(f)",
      ["    except:", "except"],
      "        return {}",
    ])],
    expected: [{ file: "app/config.py", key: "except", keywords: ["except", "swallow", "silent", "hide", "error"] }],
  }),
  makeCase({
    id: "defect-10-assignment-in-condition", description: "Assignment (=) in a condition instead of a comparison",
    title: "Skip admins in cleanup",
    parts: [modified("src/cleanup.js", 5, [
      " export function shouldDelete(user) {",
      ["+  if (user.role = \"admin\") return false;", "assign"],
      "   return user.inactiveDays > 365;",
      " }",
    ])],
    expected: [{ file: "src/cleanup.js", key: "assign", keywords: ["assign", "===", "==", "comparison"] }],
  }),
  makeCase({
    id: "defect-11-fetch-status", description: "The HTTP status is not checked before parsing JSON",
    title: "Fetch exchange rates",
    parts: [newFile("src/rates.js", [
      "export async function rates(fetchImpl) {",
      ["  const res = await fetchImpl(\"https://rates.example.invalid/latest\");", "status"],
      "  const data = await res.json();",
      "  return data.rates;",
      "}",
    ])],
    expected: [{ file: "src/rates.js", key: "status", keywords: ["status", "res.ok", "error", "check"] }],
  }),
  makeCase({
    id: "defect-12-two-defects", description: "Two defects in one diff: eval on user input and paging that is off by one",
    title: "Calculator endpoint and paging",
    parts: [
      newFile("src/calc.js", [
        "export function calc(req, res) {",
        ["  res.json({ value: eval(req.body.expr) });", "eval"],
        "}",
      ]),
      newFile("src/page.js", [
        "export function page(items, n, size) {",
        ["  return items.slice(n * size, n * size + size + 1);", "paging"],
        "}",
      ]),
    ],
    expected: [
      { file: "src/calc.js", key: "eval", keywords: ["eval", "code execution", "injection", "arbitrary"] },
      { file: "src/page.js", key: "paging", keywords: ["off-by-one", "off by one", "extra", "one more", "+ 1", "+1", "overlap"] },
    ],
  }),
  makeCase({
    id: "clean-01-parameterized", description: "Parameterized query (no SQL injection)",
    title: "Add user lookup by id",
    parts: [newFile("src/users-by-id.js", [
      "export async function findById(db, id) {",
      "  const rows = await db.query(\"SELECT id, name FROM users WHERE id = $1\", [id]);",
      "  return rows[0] ?? null;",
      "}",
    ])],
  }),
  makeCase({
    id: "clean-02-loop-correct", description: "Loop 1..length with index i - 1 is correct (a pitfall for rules)",
    title: "Number the lines",
    parts: [newFile("src/numbered.js", [
      "export function numbered(lines) {",
      "  const out = [];",
      "  for (let i = 1; i <= lines.length; i++) {",
      "    out.push(`${i}: ${lines[i - 1]}`);",
      "  }",
      "  return out;",
      "}",
    ])],
  }),
  makeCase({
    id: "clean-03-rename", description: "Only a variable rename",
    title: "Rename total to grandTotal",
    parts: [modified("src/invoice.js", 30, [
      " export function summary(lines) {",
      "-  const total = lines.reduce((a, l) => a + l.price * l.qty, 0);",
      "-  return { total };",
      "+  const grandTotal = lines.reduce((a, l) => a + l.price * l.qty, 0);",
      "+  return { total: grandTotal };",
      " }",
    ])],
  }),
  makeCase({
    id: "clean-04-docs-only", description: "Documentation only (right answer: no findings or unknown)",
    title: "Document the release process",
    parts: [newFile("docs/RELEASE.md", [
      "# Release",
      "",
      "1. Update CHANGELOG.md.",
      "2. Tag the commit: `git tag v1.2.3`.",
      "3. Push the tag. CI publishes the release.",
    ])],
  }),
  makeCase({
    id: "clean-05-py-guarded", description: "Empty list handled before the division",
    title: "Safe average",
    parts: [newFile("app/safe_stats.py", [
      "def average(times):",
      "    if not times:",
      "        return 0.0",
      "    return sum(times) / len(times)",
    ])],
  }),
];
