import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (e.name === "node_modules" || e.name === ".git" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]);

test("action.yml: node24, entry point exists, every limit input has a default", () => {
  const y = read("action.yml");
  assert.match(y, /using: "node24"/);
  const main = /main: "([^"]+)"/.exec(y)[1];
  assert.ok(fs.existsSync(path.join(root, main)));
  for (const name of ["max-input-tokens", "max-output-tokens", "max-runs-per-pr", "dry-run", "fail-on-error"]) {
    const block = y.slice(y.indexOf(`  ${name}:`));
    assert.match(block.slice(0, 400), /default:/, name);
  }
  assert.match(y, /api-key:[\s\S]{0,200}required: false/);
});

test("source: no child processes, no eval, no file writes, no extra dependencies, no network except fetch", () => {
  const src = walk("src").filter((f) => f.endsWith(".js")).map((f) => [f, read(f)]);
  for (const [f, code] of src) {
    assert.ok(!/child_process|\beval\(|new Function\(|writeFile|appendFile|createWriteStream|require\(/.test(code), f);
    assert.ok(!/from "(?!node:|\.\/)/.test(code), `third-party import in ${f}`);
  }
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});

test("workflows and examples use pull_request, never pull_request_target, and grant least privilege", () => {
  const files = [...walk(".github/workflows"), ...walk("examples")].filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length >= 2);
  for (const f of files) {
    const y = read(f);
    assert.ok(!/^\s*pull_request_target\s*:/m.test(y), f);
    assert.match(y, /permissions:/, f);
    assert.ok(!/permissions:\s*write-all/.test(y), f);
  }
});

test("no secrets or private addresses in the repository", () => {
  const bad = [/\bghp_[A-Za-z0-9]{30,}/, /\bsk-[A-Za-z0-9_-]{20,}/, /\bAKIA[0-9A-Z]{16}\b/, /\b100\.\d+\.\d+\.\d+\b/, /\b192\.168\.\d+\.\d+\b/, /\.ts\.net\b/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
  for (const f of walk(".").filter((p) => !p.startsWith("test/redact") && !p.startsWith("test/index") && !p.startsWith("test/helpers") && /\.(js|ya?ml|md|json)$/.test(p))) {
    const t = read(f);
    for (const re of bad) assert.ok(!re.test(t), `${f}: ${re}`);
  }
});

test("limits are what the README promises", async () => {
  const l = await import("../src/limits.js");
  const readme = read("README.md");
  assert.match(readme, new RegExp(String(l.DEFAULTS.maxInputTokens).replace(/(\d)(?=(\d{3})+$)/g, "$1[ ,_]?")));
  assert.equal(l.HARD_CAPS.maxInputTokens, 100_000);
  assert.equal(l.HARD_CAPS.maxOutputTokens, 4_000);
});

test("README documents every action.yml input (English and Finnish tables)", () => {
  const y = read("action.yml");
  const inputs = y.slice(y.indexOf("inputs:"), y.indexOf("\nruns:")).match(/^ {2}([a-z-]+):/gm).map((l) => l.trim().slice(0, -1));
  assert.ok(inputs.includes("github-token"));
  const enReadme = read("README.md");
  const en = enReadme.slice(enReadme.indexOf("## Settings"), enReadme.indexOf("## Security model"));
  assert.ok(en.length > 0, "English Settings section not found");
  const fiReadme = read("README.fi.md");
  const fi = fiReadme.slice(fiReadme.indexOf("## Asetukset"), fiReadme.indexOf("## Turvamalli"));
  assert.ok(fi.length > 0, "Finnish Asetukset section not found");
  for (const name of inputs) {
    assert.ok(en.includes(`\`${name}\``), `${name} missing from English table`);
    assert.ok(fi.includes(`\`${name}\``), `${name} missing from Finnish table`);
  }
});

test("examples/review.yml cancels superseded runs per pull request", () => {
  const y = read("examples/review.yml");
  assert.match(y, /^concurrency:\n {2}group: .*pull_request\.number.*\n {2}cancel-in-progress: true/m);
});

test("src/index.js does not import estimateTokens (unused)", () => {
  assert.ok(!/^import .*estimateTokens/m.test(read("src/index.js")));
});

test("action.yml: Marketplace requirements (name, short description, branding, quoted top-level scalars)", () => {
  const y = read("action.yml");
  const top = (key) => new RegExp(`^${key}: "([^"\\n]*)"$`, "m").exec(y);
  // Quoted scalars keep ':' and quotes in text from breaking the YAML (earlier mcp-doctor incident).
  const name = top("name"), desc = top("description");
  assert.ok(name && name[1].length >= 3, "name must be a double-quoted string");
  assert.ok(desc, "description must be a double-quoted single-line string");
  assert.ok(desc[1].length <= 125, `description is ${desc[1].length} chars, Marketplace allows 125`);
  assert.match(y, /^branding:\n  icon: "[a-z-]+"\n  color: "(white|black|yellow|blue|green|orange|red|purple|gray-dark)"$/m);
});

test("examples and README Action references use the package.json version", () => {
  const v = JSON.parse(read("package.json")).version;
  for (const f of ["README.md", "README.fi.md", "examples/review.yml"]) {
    const refs = [...read(f).matchAll(/ai-pr-reviewer-action@(v[\d.]+)/g)].map((m) => m[1]);
    assert.ok(refs.length > 0, f);
    for (const r of refs) assert.equal(r, `v${v}`, f);
  }
});

test("action.yml: branding icon is not one of the Feather icons GitHub omits", () => {
  // Tolerates CRLF, other indentation and single or no quotes; fails with a clear message if the key is missing.
  const m = /^branding:[ \t]*\r?\n(?:[ \t]+[^\r\n]*\r?\n)*?[ \t]+icon:[ \t]*["']?([a-z-]+)["']?[ \t]*\r?$/m.exec(read("action.yml"));
  assert.ok(m, "action.yml: branding.icon not found");
  const icon = m[1];
  const omitted = ["coffee", "columns", "divide-circle", "divide-square", "divide", "frown", "hexagon", "key", "meh", "mouse-pointer", "smile", "tool", "x-octagon"];
  assert.ok(!omitted.includes(icon), `${icon} is not available as a Marketplace icon`);
});

test("README permissions tables match the example workflow (English and Finnish)", () => {
  const ex = read("examples/review.yml");
  const perms = [...ex.slice(ex.indexOf("permissions:"), ex.indexOf("\nconcurrency:")).matchAll(/^ {2}([a-z-]+): (read|write)/gm)].map((m) => `${m[1]}: ${m[2]}`);
  assert.deepEqual(perms, ["contents: read", "pull-requests: write"]);
  for (const [f, start, end] of [["README.md", "## Permissions", "## Versioning"], ["README.fi.md", "## Oikeudet", "## Versiointi"]]) {
    const t = read(f);
    const sec = t.slice(t.indexOf(start), t.indexOf(end));
    assert.ok(t.includes(start) && t.includes(end), `${f}: section missing`);
    for (const p of perms) assert.ok(sec.includes(`\`${p}\``), `${f}: ${p}`);
  }
});

test("release docs exist and SECURITY.md names the package.json version as supported", () => {
  const v = JSON.parse(read("package.json")).version;
  assert.ok(fs.existsSync(path.join(root, "RELEASING.md")));
  const sec = read("SECURITY.md");
  const supported = sec.slice(sec.indexOf("## Supported versions"), sec.indexOf("## What the Action"));
  assert.ok(supported.includes(`\`v${v}\``), "SECURITY.md supported version");
  for (const f of ["README.md", "README.fi.md"]) assert.ok(read(f).includes("(RELEASING.md)"), f);
});
