import assert from "node:assert/strict";
import test from "node:test";
import { addedLines, numberedPatch, skipReason } from "../src/diff.js";

const patch = "@@ -1,3 +1,5 @@\n a\n+b\n+c\n d\n-old\n@@ -20,2 +22,3 @@\n x\n+y\n z\n\\ No newline at end of file";

test("addedLines: only '+' lines, numbered in the new file, across hunks", () => {
  assert.deepEqual([...addedLines(patch)].sort((a, b) => a - b), [2, 3, 23]);
});

test("addedLines: removed lines do not advance the new-file counter", () => {
  assert.deepEqual([...addedLines("@@ -1,3 +1,2 @@\n-a\n-b\n+c\n d")], [1]);
});

test("addedLines: garbage and missing patch give an empty set", () => {
  assert.equal(addedLines(undefined).size, 0);
  assert.equal(addedLines("+not in a hunk").size, 0);
});

test("numberedPatch: numbers added and context lines, not removed ones", () => {
  const out = numberedPatch(patch).split("\n");
  assert.ok(out.includes("2: +b"));
  assert.ok(out.includes("3: +c"));
  assert.ok(out.includes("4:  d"));
  assert.ok(out.includes("24:  z"));
  assert.ok(out.includes("1:  a"));
  assert.ok(out.includes("   -old"));
  assert.ok(out.includes("23: +y"));
  assert.ok(!out.some((l) => l.includes("No newline")));
});

test("skipReason: secrets-like, lockfiles, binary, removed and empty patches are never sent", () => {
  const f = (filename, extra = {}) => ({ filename, status: "modified", patch: "@@ -1 +1 @@\n+x", ...extra });
  assert.equal(skipReason(f("src/a.js")), null);
  for (const n of [".env", "config/.env.production", "certs/server.pem", "id_rsa", "a/b/id_ed25519.pub", "package-lock.json", "yarn.lock", "dist/app.min.js", "logo.png", "keys/x.key"]) {
    assert.notEqual(skipReason(f(n)), null, n);
  }
  assert.notEqual(skipReason(f("a.js", { status: "removed" })), null);
  assert.notEqual(skipReason(f("a.js", { patch: undefined })), null);
  assert.notEqual(skipReason(null), null);
});

test("skipReason: more credential files are never sent", () => {
  const names = ["credentials.json", "config/secrets.yml", "secrets.yaml", ".npmrc", "a/.netrc", ".htpasswd", "prod.tfvars", "terraform.tfstate", "x.jks", "app.keystore", "AuthKey.p8", "db.kdbx"];
  for (const filename of names) {
    assert.equal(skipReason({ filename, status: "modified", patch: "@@ -1 +1 @@\n+x" }), "excluded file type", filename);
  }
  assert.equal(skipReason({ filename: "src/secrets.js", status: "modified", patch: "@@ -1 +1 @@\n+x" }), null);
});
