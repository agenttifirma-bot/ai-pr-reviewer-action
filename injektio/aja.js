#!/usr/bin/env node
// Ajaa injektiotapaukset oikean run()-polun lapi (GitHub korvattu feikilla, mallipalvelin joko feikki tai oikea).
//   node injektio/aja.js --keinomalli naiivi|kestava|lainaava     offline, ei verkkoa, ei kuluja
//   LLM_API_KEY=... node injektio/aja.js --base-url https://... --malli NIMI [--malli NIMI2] [--ulos kokeilut.jsonl]
// Elava ajo: kovat ylarajat koodissa (MAX_KUTSUJA), avainta ei tulosteta eika kirjoiteta, virheista vain tyyppi.
import fs from "node:fs";
import path from "node:path";
import { run } from "../src/index.js";
import { checkBaseUrl } from "../src/llm.js";
import { baseEnv, eventFile, fakeNet } from "../test/helpers.js";
import { KEINOMALLIT } from "./mallit.js";
import { pisteyta, TULOKSET } from "./pisteyta.js";
import { TAPAUKSET } from "./tapaukset.js";

export const MAX_KUTSUJA = 60;       // kova katto yhdelle ajolle (tapaukset x mallit)
export const MAX_ULOSTULO = 800;     // max_tokens per kutsu
const FAKE_BASE = "https://llm.example/v1";

/** Ajaa yhden tapauksen. fetchLlm(url, init) -> Response; null = feikkimalli reply-funktiolla. */
export async function ajaaTapaus(tapaus, { malli, reply, liveBase, apiKey }) {
  const llmBase = liveBase ?? FAKE_BASE;
  let raaka = null;
  const net = fakeNet({
    files: tapaus.tiedostot,
    reply: (body) => {
      raaka = reply(body);
      return raaka;
    },
  });
  const env = baseEnv({
    GITHUB_EVENT_PATH: eventFile({ title: tapaus.otsikko }),
    "INPUT_BASE-URL": llmBase,
    INPUT_MODEL: malli,
    "INPUT_MAX-OUTPUT-TOKENS": String(MAX_ULOSTULO),
    ...(apiKey ? { "INPUT_API-KEY": apiKey } : {}),
  });
  const fetchImpl = liveBase
    ? async (url, init) => {
        if (!String(url).startsWith(`${liveBase}/`)) return net.fetchImpl(url, init);
        net.calls.push({ url: String(url), method: init?.method ?? "GET" });
        const res = await fetch(url, init);
        const kopio = res.clone();
        try { raaka = (await kopio.json())?.choices?.[0]?.message?.content ?? null; } catch { raaka = null; }
        return res;
      }
    : net.fetchImpl;
  let virhe = null;
  try {
    await run({ env, fetchImpl, log: { log() {} } });
  } catch (e) {
    virhe = e?.code ?? e?.constructor?.name ?? "virhe"; // vain tyyppi, ei viestia
  }
  const kommentti = net.state.comments.at(-1)?.body ?? null;
  const kommenttiValmis = kommentti && !kommentti.includes("Review in progress") ? kommentti : null;
  const verkko = net.calls.map((c) => ({ method: c.method, url: c.url }));
  const kutsuja = verkko.filter((c) => c.url.endsWith("/chat/completions")).length;
  return { ...pisteyta(tapaus, { raaka, kommentti: kommenttiValmis, virhe, verkko, llmBase, kutsuja }), virhe };
}

export function yhteenveto(rivit) {
  const n = Object.fromEntries(TULOKSET.map((t) => [t, 0]));
  let rikkeita = 0;
  for (const r of rivit) {
    n[r.luokka] += 1;
    rikkeita += r.rikkeet.length;
  }
  const hyokkaukset = rivit.filter((r) => !r.id.startsWith("kontrolli-"));
  const kontrolli = rivit.find((r) => r.id.startsWith("kontrolli-"));
  const palvelevat = rivit.filter((r) => r.palvelee !== null);
  return {
    ...n, rikkeita,
    hyokkayksia: hyokkaukset.length,
    totteli_osuus: hyokkaukset.length ? hyokkaukset.filter((r) => r.luokka === "totteli").length / hyokkaukset.length : 0,
    kontrolli_kunnossa: kontrolli ? kontrolli.luokka === "pidatti" : null,
    loysi_oikean_vian: `${palvelevat.filter((r) => r.palvelee).length}/${palvelevat.length}`,
  };
}

export function taulu(rivit) {
  const out = ["| tapaus | tulos | loysi oikean vian | rikkeet |", "|---|---|---|---|"];
  for (const r of rivit) out.push(`| ${r.id} | ${r.luokka}${r.virhe ? ` (${r.virhe})` : ""} | ${r.palvelee === null ? "-" : r.palvelee ? "kylla" : "ei"} | ${r.rikkeet.map((x) => x.tyyppi).join(", ") || "-"} |`);
  return out.join("\n");
}

/** Yksi rivi hiekkalaatikon kokeilut.jsonl-muotoon (kentat tasmalleen hl.py:n KENTAT): totteluiden maara rajarikkeina. */
export function kokeiluRivi({ malli, adapteri, rivit, kestoS, lokit }) {
  const aika = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const totteli = rivit.filter((r) => r.luokka === "totteli").map((r) => r.id);
  const luvaton = rivit.flatMap((r) => r.rikkeet.map((x) => `${r.id}:${x.tyyppi}`));
  const rajarikkeet = [];
  if (totteli.length) rajarikkeet.push({ tyyppi: "injektio_totteli", maara: totteli.length, kohteet: totteli });
  if (luvaton.length) rajarikkeet.push({ tyyppi: "injektio_rike", maara: luvaton.length, kohteet: luvaton });
  const virheita = rivit.filter((r) => r.luokka === "virhe").length;
  return {
    id: `${aika.replace(/[-:]/g, "")}-injektio-01-${adapteri}-${malli.replace(/[^A-Za-z0-9]/g, "_")}`,
    aika, kokeilu: "injektio-01", adapteri, malli, kesto_s: Math.round(kestoS),
    kustannus_usd: null, lopputulos: virheita === rivit.length ? "epaonnistui" : "onnistui",
    rajarikkeet, lokit,
  };
}

function args(argv) {
  const a = { mallit: [], keinomallit: [] };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--malli") a.mallit.push(argv[++i]);
    else if (k === "--keinomalli") a.keinomallit.push(argv[++i]);
    else if (k === "--base-url") a.baseUrl = argv[++i];
    else if (k === "--ulos") a.ulos = argv[++i];
    else if (k === "--json") a.json = argv[++i];
    else throw new Error(`tuntematon valitsin: ${k}`);
  }
  return a;
}

async function main() {
  const a = args(process.argv);
  const ajot = [];
  if (a.keinomallit.length) {
    for (const nimi of a.keinomallit) {
      if (!KEINOMALLIT[nimi]) throw new Error(`tuntematon keinomalli: ${nimi}`);
      ajot.push({ malli: `keinomalli-${nimi}`, adapteri: "keinomalli", reply: KEINOMALLIT[nimi] });
    }
  } else {
    if (!a.baseUrl || a.mallit.length === 0) throw new Error("kayta --keinomalli NIMI tai --base-url URL --malli NIMI");
    const apiKey = process.env.LLM_API_KEY ?? "";
    if (!apiKey) throw new Error("LLM_API_KEY puuttuu ymparistosta");
    const base = checkBaseUrl(a.baseUrl);
    if (a.mallit.length * TAPAUKSET.length > MAX_KUTSUJA) throw new Error(`liikaa kutsuja (max ${MAX_KUTSUJA})`);
    for (const m of a.mallit) ajot.push({ malli: m, adapteri: "ai-pr-reviewer", liveBase: base, apiKey });
  }
  const kaikki = [];
  for (const ajo of ajot) {
    const alku = Date.now();
    const rivit = [];
    for (const t of TAPAUKSET) rivit.push(await ajaaTapaus(t, ajo));
    const kestoS = (Date.now() - alku) / 1000;
    console.log(`\n## ${ajo.malli}\n\n${taulu(rivit)}\n\n${JSON.stringify(yhteenveto(rivit))}`);
    kaikki.push({ malli: ajo.malli, rivit, yhteenveto: yhteenveto(rivit) });
    if (a.ulos) {
      const rivi = kokeiluRivi({ malli: ajo.malli, adapteri: ajo.adapteri, rivit, kestoS, lokit: path.resolve(a.json ?? `${a.ulos}.tapaukset.json`) });
      fs.appendFileSync(a.ulos, `${JSON.stringify(rivi)}\n`);
    }
  }
  if (a.ulos) fs.writeFileSync(a.json ?? `${a.ulos}.tapaukset.json`, JSON.stringify(kaikki, null, 1));
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  main().catch((e) => { console.error(`virhe: ${e?.constructor?.name}`); process.exitCode = 1; });
}
