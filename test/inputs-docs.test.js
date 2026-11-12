import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// Keeps the inputs in action.yml, README (and README.fi.md if it exists) and
// examples/review.yml in sync. No YAML dependency: the files use a simple layout.
const root = new URL("../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), "utf8");
const exists = (p) => fs.existsSync(new URL(p, root));

const unquote = (s) => s.trim().replace(/^(["'])(.*)\1$/, "$2");
const norm = (s) => s.replace(/[`\s]/g, "").replace(/^["']|["']$/g, "");

// inputs: { name: { required: bool, default: string|null } }
export function parseActionInputs(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^inputs:\s*$/.test(l));
  assert.ok(start >= 0, "action.yml: no inputs block");
  const inputs = {};
  let cur = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // next top-level key
    let m = line.match(/^ {2}([\w-]+):\s*$/);
    if (m) { cur = inputs[m[1]] = { required: false, default: null }; continue; }
    m = line.match(/^ {4}(required|default):\s*(.*)$/);
    if (m && cur) {
      if (m[1] === "required") cur.required = unquote(m[2]) === "true";
      else cur.default = unquote(m[2]);
    }
  }
  return inputs;
}

// Input names used in `with:` blocks of the workflow steps found in the text.
export function withInputs(text) {
  const lines = text.split("\n");
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)with:\s*$/);
    if (!m) continue;
    const base = m[1].length;
    const names = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === "" || /^\s*#/.test(lines[j])) continue;
      const ind = lines[j].match(/^\s*/)[0].length;
      if (ind <= base) break;
      const k = lines[j].match(/^\s*([\w-]+):/);
      if (k) names.push(k[1]);
    }
    found.push(names);
  }
  return found;
}

// `uses:` of this action followed by its with-block: only blocks of this action count.
function actionBlocks(text) {
  const blocks = [];
  const re = /uses:\s*tonyweckstrom1987\/ai-pr-reviewer-action@\S+\s*\n/g;
  let m;
  while ((m = re.exec(text))) {
    const rest = text.slice(m.index + m[0].length);
    const w = withInputs(rest.split("\n").slice(0, 40).join("\n"))[0] ?? [];
    blocks.push(w);
  }
  return blocks;
}

function tableRows(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!/^\|\s*`/.test(line)) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
    const names = [...cells[0].matchAll(/`([\w-]+)`/g)].map((x) => x[1]);
    rows.push({ names, def: cells[1] ?? "" });
  }
  return rows;
}

const inputs = parseActionInputs(read("action.yml"));
const known = Object.keys(inputs);
const requiredNames = known.filter((n) => inputs[n].required);
const readmes = ["README.md", "README.fi.md"].filter(exists);
const docs = [{ file: "examples/review.yml", text: read("examples/review.yml") },
  ...readmes.map((f) => ({ file: f, text: read(f) }))];

test("action.yml: parser finds the inputs and required flags", () => {
  assert.ok(known.length >= 10, `only ${known.length} inputs parsed`);
  assert.ok(requiredNames.includes("base-url") && requiredNames.includes("model"));
  assert.equal(inputs["max-input-tokens"].default, "20000");
});

for (const { file, text } of docs) {
  const blocks = actionBlocks(text);
  test(`${file}: contains at least one usage block of this action`, () => {
    assert.ok(blocks.length >= 1, "no `uses: ...ai-pr-reviewer-action@...` with `with:` block");
  });
  blocks.forEach((names, i) => {
    test(`${file}: with-block #${i + 1} uses only inputs known to action.yml`, () => {
      const unknown = names.filter((n) => !known.includes(n));
      assert.deepEqual(unknown, [], `unknown inputs: ${unknown.join(", ")}`);
    });
    test(`${file}: with-block #${i + 1} sets every required input`, () => {
      const missing = requiredNames.filter((n) => !names.includes(n));
      assert.deepEqual(missing, [], `missing required inputs: ${missing.join(", ")}`);
    });
  });
}

for (const file of readmes) {
  const rows = tableRows(read(file));
  test(`${file}: settings table names only inputs known to action.yml`, () => {
    const listed = rows.flatMap((r) => r.names);
    assert.ok(listed.length > 0, "no settings table found");
    const unknown = listed.filter((n) => !known.includes(n));
    assert.deepEqual(unknown, [], `unknown inputs in table: ${unknown.join(", ")}`);
  });
  test(`${file}: settings table lists every input of action.yml`, () => {
    const listed = new Set(rows.flatMap((r) => r.names));
    const missing = known.filter((n) => !listed.has(n));
    assert.deepEqual(missing, [], `inputs missing from table: ${missing.join(", ")}`);
  });
  test(`${file}: table defaults and required marks match action.yml`, () => {
    const problems = [];
    for (const { names, def } of rows) {
      for (const n of names) {
        const spec = inputs[n];
        if (!spec) continue;
        const d = norm(def).toLowerCase();
        if (spec.required) {
          if (!/required|pakollinen/.test(d)) problems.push(`${n}: required in action.yml, table says "${def}"`);
        } else if (spec.default === null || spec.default === "") {
          if (!/empty|tyhjä|^$/.test(d)) problems.push(`${n}: no default in action.yml, table says "${def}"`);
        } else if (d !== norm(spec.default).toLowerCase()) {
          problems.push(`${n}: default "${spec.default}" in action.yml, table says "${def}"`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });
}
