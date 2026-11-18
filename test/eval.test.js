import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ajaTapaus, NAUHAHAKEMISTO, nauhoita, pyyntoTiiviste, toista } from "../eval/aja.js";
import { KEINOMALLIT, lisatytRivit } from "../eval/keinomallit.js";
import { osuu, pisteyta, yhteenveto } from "../eval/pisteyta.js";
import { TAPAUKSET } from "../eval/tapaukset.js";
import { addedLines } from "../src/diff.js";

const lueNauha = (nimi) => JSON.parse(fs.readFileSync(path.join(NAUHAHAKEMISTO, nimi), "utf8"));
const t = (id) => TAPAUKSET.find((x) => x.id === id);

test("eval: 10-20 cases, unique ids, both buggy and clean diffs", () => {
  assert.ok(TAPAUKSET.length >= 10 && TAPAUKSET.length <= 20);
  assert.equal(new Set(TAPAUKSET.map((x) => x.id)).size, TAPAUKSET.length);
  assert.ok(TAPAUKSET.some((x) => x.puhdas) && TAPAUKSET.some((x) => !x.puhdas));
});

test("eval: every expected finding points at an ADDED line of a file in the case", () => {
  for (const c of TAPAUKSET) {
    for (const o of c.odotetut) {
      const f = c.tiedostot.find((x) => x.filename === o.file);
      assert.ok(f, `${c.id}: ${o.file}`);
      assert.ok(addedLines(f.patch).has(o.line), `${c.id}: ${o.file}:${o.line} is not an added line`);
      assert.ok(o.avainsanat.length > 0);
    }
  }
});

test("eval: matching needs same file, line within tolerance and a keyword", () => {
  const o = { file: "a.js", line: 10, avainsanat: ["sql"] };
  assert.ok(osuu({ file: "a.js", line: 11, message: "SQL injection" }, o));
  assert.ok(!osuu({ file: "a.js", line: 12, message: "SQL injection" }, o));
  assert.ok(!osuu({ file: "b.js", line: 10, message: "SQL injection" }, o));
  assert.ok(!osuu({ file: "a.js", line: 10, message: "naming could be better" }, o));
});

test("eval: scoring counts hits, misses, false alarms, duplicates, unknown and errors", () => {
  const c = t("vika-12-kaksi-vikaa");
  const [evalLine, pageLine] = c.odotetut.map((o) => o.line);
  const r = pisteyta(c, { review: { result: "ok", dropped: 1, findings: [
    { file: "src/calc.js", line: evalLine, message: "eval allows arbitrary code" },
    { file: "src/calc.js", line: evalLine, message: "eval again" },
    { file: "src/calc.js", line: 1, message: "function name is short" },
  ] } });
  assert.deepEqual([r.tila, r.osumat, r.ohitetut, r.vaarat, r.kaksoiskappaleet, r.pudotetut], ["ok", 1, 1, 1, 1, 1]);
  assert.equal(pageLine > 0, true);
  const u = pisteyta(c, { review: { result: "unknown", findings: [] } });
  assert.deepEqual([u.tila, u.osumat, u.ohitetut, u.vaarat], ["unknown", 0, 2, 0]);
  const v = pisteyta(c, { review: null, virhe: "model_reply_no_json" });
  assert.deepEqual([v.tila, v.virhe, v.ohitetut], ["virhe", "model_reply_no_json", 2]);
  const y = yhteenveto([r, u, v]);
  assert.equal(y.kattavuus, 0.167);
  assert.equal(y.tarkkuus, 0.5);
  assert.equal(y.unknown, 1);
  assert.equal(y.virheet, 1);
});

test("eval: a clean diff with any finding is not silent", () => {
  const c = t("puhdas-01-parametrit");
  const r = pisteyta(c, { review: { result: "ok", findings: [{ file: "src/users-by-id.js", line: 2, message: "SQL injection" }] } });
  assert.equal(r.vaarat, 1);
  assert.equal(yhteenveto([r]).puhtaat_hiljaa, "0/1");
  assert.equal(yhteenveto([r]).tarkkuus, 0);
});

test("eval: rule baseline only reads added lines from the model message", () => {
  const user = "<data>\nPR TITLE: x\n\n=== FILE: a.js ===\n@@ -1,2 +1,3 @@\n1:  keep();\n2: +eval(x);\n   -old();\n</data>";
  assert.deepEqual(lisatytRivit(user), [{ file: "a.js", line: 2, code: "eval(x);" }]);
});

test("eval: committed cassettes replay without stale or missing cases (re-record after prompt changes)", async () => {
  const nimet = fs.readdirSync(NAUHAHAKEMISTO).filter((f) => f.endsWith(".json"));
  assert.ok(nimet.length >= 2);
  for (const n of nimet) {
    const r = await toista(lueNauha(n));
    assert.deepEqual(r.vanhentuneet, [], n);
    assert.deepEqual(r.puuttuvat, [], n);
    assert.equal(r.yhteenveto.virheet, 0, n);
  }
});

test("eval: reference stub scores 100 %, so the pipeline and scorer agree with the expected answers", async () => {
  const r = await toista(lueNauha("keinomalli-viite.json"));
  assert.equal(r.yhteenveto.kattavuus, 1);
  assert.equal(r.yhteenveto.tarkkuus, 1);
  assert.equal(r.yhteenveto.vaarat_halytykset, 0);
});

test("eval: rule baseline numbers match the README quality table", async () => {
  const y = (await toista(lueNauha("keinomalli-saantopohja.json"))).yhteenveto;
  assert.deepEqual(
    [y.osumat, y.odotettuja, y.vaarat_halytykset, y.kattavuus, y.tarkkuus, y.puhtaat_hiljaa],
    [7, 13, 1, 0.538, 0.875, "4/5"],
  );
  for (const f of ["README.md", "README.fi.md"]) {
    const md = fs.readFileSync(f, "utf8");
    assert.match(md, /\| 7\/13 \| 1 \| 4\/5 \|/, f);
  }
});

test("eval: a changed request marks the case stale and keeps it out of the score", async () => {
  const n = lueNauha("keinomalli-viite.json");
  n.vastaukset["vika-01-sql-ketjutus"].pyynto_sha256 = "0".repeat(64);
  delete n.vastaukset["vika-02-silmukka-yli"];
  const r = await toista(n);
  assert.deepEqual(r.vanhentuneet, ["vika-01-sql-ketjutus"]);
  assert.deepEqual(r.puuttuvat, ["vika-02-silmukka-yli"]);
  assert.equal(r.yhteenveto.tapauksia, TAPAUKSET.length - 2);
});

test("eval: re-recording a stub gives the same request hashes and replies as the committed cassette", async () => {
  for (const nimi of Object.keys(KEINOMALLIT)) {
    const uusi = await nauhoita({ malli: `keinomalli-${nimi}`, lahde: "keinomalli", keinomalli: KEINOMALLIT[nimi] });
    const vanha = lueNauha(`keinomalli-${nimi}.json`);
    assert.deepEqual(uusi.vastaukset, vanha.vastaukset, nimi);
  }
});

test("eval: live recording sends one call per case, never stores the API key, keeps usage", async (tt) => {
  const avain = "eval-test-key-not-real-0123456789";
  const kutsut = [];
  tt.mock.method(globalThis, "fetch", async (url, init) => {
    kutsut.push({ url: String(url), auth: init.headers.authorization });
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: KEINOMALLIT.viite(body, t("vika-01-sql-ketjutus")) } }], usage: { prompt_tokens: 500, completion_tokens: 40 } }), { status: 200 });
  });
  const tapaukset = [t("vika-01-sql-ketjutus")];
  const nauha = await nauhoita({ malli: "m", lahde: "elava", live: { base: "http://localhost:9/v1", apiKey: avain } }, tapaukset);
  assert.equal(kutsut.length, 1);
  assert.equal(kutsut[0].url, "http://localhost:9/v1/chat/completions");
  assert.equal(kutsut[0].auth, `Bearer ${avain}`);
  assert.ok(!JSON.stringify(nauha).includes(avain));
  const v = nauha.vastaukset["vika-01-sql-ketjutus"];
  assert.deepEqual(v.usage, { input: 500, output: 40 });
  const r = await toista(nauha, tapaukset);
  assert.equal(r.yhteenveto.osumat, 1);
});

test("eval: request hash depends on system and user text only", () => {
  const b = (s, u, m) => ({ model: m, messages: [{ content: s }, { content: u }] });
  assert.equal(pyyntoTiiviste(b("s", "u", "a")), pyyntoTiiviste(b("s", "u", "b")));
  assert.notEqual(pyyntoTiiviste(b("s", "u", "a")), pyyntoTiiviste(b("s2", "u", "a")));
});

test("eval: the replay path goes through run() and its validation (findings on unseen lines are dropped)", async () => {
  const c = t("vika-01-sql-ketjutus");
  const r = await ajaTapaus(c, { malli: "x", vastaa: () => ({ content: JSON.stringify({ result: "ok", summary: "s", findings: [{ file: "src/users.js", line: 99, severity: "high", confidence: "high", message: "SQL injection" }] }) }) });
  assert.equal(r.review.findings.length, 0);
  assert.equal(r.review.dropped, 1);
});
