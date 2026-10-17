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
