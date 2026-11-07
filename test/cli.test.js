import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ajaaTapaus, kokeiluRivi, taulu, yhteenveto } from "../injektio/aja.js";
import { KEINOMALLIT } from "../injektio/mallit.js";
import { TAPAUKSET } from "../injektio/tapaukset.js";
import { run } from "../src/index.js";
import { baseEnv, fakeNet, json, okReply, silent } from "./helpers.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AJA = path.join(ROOT, "injektio", "aja.js");
const INDEX = path.join(ROOT, "src", "index.js");

// Lapsiprosessille annetaan tyhja ymparisto: ei avaimia, ei verkkoa.
const kaynnista = (script, args, env = {}) =>
  spawnSync(process.execPath, [script, ...args], { cwd: ROOT, env: { PATH: process.env.PATH, ...env }, encoding: "utf8", timeout: 60_000 });

// --- index.run: varauskommentti ---

test("run: jos varauskommentin vastauksessa ei ole id:ta, valmis arvio luodaan uutena kommenttina", async () => {
  const net = fakeNet({ reply: okReply() });
  let posts = 0;
  const fetchImpl = async (url, init = {}) => {
    if (init.method === "POST" && /\/issues\/\d+\/comments/.test(String(url))) {
      posts += 1;
      if (posts === 1) return json({}, 201); // varaus onnistuu, mutta id puuttuu
    }
    return net.fetchImpl(url, init);
  };
  const r = await run({ env: baseEnv(), fetchImpl, log: silent });
  assert.equal(r.outcome, "reviewed");
  assert.equal(posts, 2);
  assert.equal(net.state.comments.length, 1);
  assert.ok(!net.state.comments[0].body.includes("Review in progress"));
});

// --- src/index.js: komentorivikaynnistys ---

test("src/index.js suoraan ajettuna: tuettu tapahtuma puuttuu -> ::error::-rivi ja poistumiskoodi 1, ei verkkoa", () => {
  const r = kaynnista(INDEX, [], { GITHUB_EVENT_NAME: "push" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^::error::ai-pr-reviewer: unsupported_event/m);
});

test("src/index.js suoraan ajettuna: ilman api-avainta ajo ohitetaan koodilla 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aipr-cli-"));
  const event = path.join(dir, "event.json");
  fs.writeFileSync(event, JSON.stringify({ pull_request: { number: 3, head: { sha: "a".repeat(40) } } }));
  const r = kaynnista(INDEX, [], { GITHUB_EVENT_NAME: "pull_request", GITHUB_REPOSITORY: "octo/demo", GITHUB_EVENT_PATH: event });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /::notice::ai-pr-reviewer: skipped_no_key/);
});

// --- injektio/aja.js: ajaaTapaus, taulu ---

test("ajaaTapaus: putken virhe kirjataan vain koodina (ei viestia) ja tapaus luokitellaan virheeksi", async () => {
  const t = TAPAUKSET.find((x) => x.id.startsWith("kontrolli-"));
  const r = await ajaaTapaus(t, { malli: "m", reply: () => "ei JSONia ollenkaan" });
  assert.equal(r.virhe, "model_reply_no_json");
  assert.equal(r.luokka, "virhe");
});

test("taulu: yksi rivi per tapaus, virhe ja puuttuva palvelee-tieto nakyvat oikein", () => {
  const rivit = [
    { id: "a", luokka: "pidatti", virhe: null, palvelee: true, rikkeet: [] },
    { id: "b", luokka: "virhe", virhe: "llm_network", palvelee: false, rikkeet: [{ tyyppi: "x" }, { tyyppi: "y" }] },
    { id: "c", luokka: "totteli", virhe: null, palvelee: null, rikkeet: [] },
  ];
  const rivit2 = taulu(rivit).split("\n");
  assert.equal(rivit2.length, 5);
  assert.equal(rivit2[2], "| a | pidatti | kylla | - |");
  assert.equal(rivit2[3], "| b | virhe (llm_network) | ei | x, y |");
  assert.equal(rivit2[4], "| c | totteli | - | - |");
});

test("yhteenveto: tyhja rivijoukko ei jaa nollalla, kontrolli puuttuu -> null", () => {
  const y = yhteenveto([]);
  assert.equal(y.hyokkayksia, 0);
  assert.equal(y.totteli_osuus, 0);
  assert.equal(y.kontrolli_kunnossa, null);
  assert.equal(y.loysi_oikean_vian, "0/0");
});

test("kokeiluRivi: kun kaikki tapaukset paattyvat virheeseen, lopputulos on 'epaonnistui'", () => {
  const rivit = [{ id: "a", luokka: "virhe", rikkeet: [] }, { id: "b", luokka: "virhe", rikkeet: [] }];
  const r = kokeiluRivi({ malli: "m/1", adapteri: "x", rivit, kestoS: 0.4, lokit: "l.json" });
  assert.equal(r.lopputulos, "epaonnistui");
  assert.deepEqual(r.rajarikkeet, []);
  assert.equal(r.kesto_s, 0);
});

// --- injektio/aja.js: komentorivi ---

test("aja.js --keinomalli: ajaa kaikki tapaukset offline ja kirjoittaa --ulos-tiedostot", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aipr-aja-"));
  const ulos = path.join(dir, "kokeilut.jsonl");
  const lokit = path.join(dir, "tapaukset.json");
  const r = kaynnista(AJA, ["--keinomalli", "kestava", "--ulos", ulos, "--json", lokit]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /## keinomalli-kestava/);
  assert.match(r.stdout, /\| tapaus \| tulos \|/);

  const rivit = fs.readFileSync(ulos, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(rivit.length, 1);
  assert.equal(rivit[0].kokeilu, "injektio-01");
  assert.equal(rivit[0].adapteri, "keinomalli");
  assert.equal(rivit[0].lopputulos, "onnistui");
  assert.equal(rivit[0].lokit, lokit);
  assert.deepEqual(rivit[0].rajarikkeet, []);

  const kaikki = JSON.parse(fs.readFileSync(lokit, "utf8"));
  assert.equal(kaikki.length, 1);
  assert.equal(kaikki[0].rivit.length, TAPAUKSET.length);
});

test("aja.js: useampi --keinomalli tuottaa oman osionsa ja oman jsonl-rivinsa kullekin", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aipr-aja-"));
  const ulos = path.join(dir, "k.jsonl");
  const r = kaynnista(AJA, ["--keinomalli", "naiivi", "--keinomalli", "lainaava", "--ulos", ulos]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /## keinomalli-naiivi/);
  assert.match(r.stdout, /## keinomalli-lainaava/);
  const rivit = fs.readFileSync(ulos, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(rivit.length, 2);
  // oletuspolku lokeille: <ulos>.tapaukset.json
  assert.ok(fs.existsSync(`${ulos}.tapaukset.json`));
  // naiivi totteli -> rajarike kirjataan
  assert.ok(rivit[0].rajarikkeet.some((x) => x.tyyppi === "injektio_totteli"));
});

test("aja.js ilman --ulos ei kirjoita tiedostoja", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aipr-aja-"));
  const r = spawnSync(process.execPath, [AJA, "--keinomalli", "kestava"], { cwd: dir, env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("aja.js: virheelliset argumentit paattyvat koodiin 1 ja lyhyeen virheilmoitukseen", () => {
  const huono = [
    ["--tuntematon"],
    ["--keinomalli", "olematon"],
    [],
    ["--base-url", "https://llm.example/v1"],
    ["--malli", "m"],
  ];
  for (const argv of huono) {
    const r = kaynnista(AJA, argv);
    assert.equal(r.status, 1, JSON.stringify(argv));
    assert.match(r.stderr, /^virhe: Error\s*$/, JSON.stringify(argv));
    assert.equal(r.stdout, "", JSON.stringify(argv));
  }
});

test("aja.js: elava ajo ilman LLM_API_KEY:ta pysahtyy ennen verkkoa", () => {
  const r = kaynnista(AJA, ["--base-url", "https://llm.example/v1", "--malli", "m"]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
});

test("aja.js: elava ajo kieltaytyy, jos kutsuja olisi yli kovan katon, eika tulosta avainta", () => {
  const avain = "test-key-not-real-0123456789";
  const malleja = Math.floor(60 / TAPAUKSET.length) + 1;
  const argv = ["--base-url", "https://llm.example/v1"];
  for (let i = 0; i < malleja; i++) argv.push("--malli", `m${i}`);
  const r = kaynnista(AJA, argv, { LLM_API_KEY: avain });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.ok(!r.stderr.includes(avain));
});

test("aja.js: elava ajo hylkaa ei-https-osoitteen (muu kuin paikallinen) ennen kutsuja", () => {
  const r = kaynnista(AJA, ["--base-url", "http://llm.example/v1", "--malli", "m"], { LLM_API_KEY: "test-key-not-real" });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
});

test("KEINOMALLIT: kaikki kolme nimea ovat funktioita, joita --keinomalli voi kayttaa", () => {
  assert.deepEqual(Object.keys(KEINOMALLIT).sort(), ["kestava", "lainaava", "naiivi"]);
});
