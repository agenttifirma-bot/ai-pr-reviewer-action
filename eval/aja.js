#!/usr/bin/env node
// Laatumittari: ajaa tapaukset oikean run()-polun lapi (GitHub korvattu feikilla) ja laskee osumat ja vaarat halytykset.
//
//   node eval/aja.js                                   toisto: kaikki eval/nauhat/*.json, ei verkkoa, ei kuluja
//   node eval/aja.js --nauha eval/nauhat/X.json [--tiukka]
//   node eval/aja.js --nauhoita --keinomalli saantopohja|viite
//   LLM_API_KEY=... node eval/aja.js --nauhoita --base-url https://.../v1 --malli NIMI [--ulos eval/nauhat/NIMI.json]
//
// Nauha (cassette) tallentaa mallin raakavastauksen ja pyynnon tiivisteen (system + user). Jos kehote tai
// tapaus muuttuu, tiiviste ei tasmaa ja tapaus merkitaan vanhentuneeksi: sita ei pisteyteta.
// Elava nauhoitus: kova katto MAX_KUTSUJA, avainta ei tulosteta eika tallenneta, virheista vain tyyppi.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { run } from "../src/index.js";
import { DEFAULTS } from "../src/limits.js";
import { checkBaseUrl } from "../src/llm.js";
import { SYSTEM_PROMPT } from "../src/prompt.js";
import { baseEnv, eventFile, fakeNet } from "../test/helpers.js";
import { KEINOMALLIT } from "./keinomallit.js";
import { pisteyta, yhteenveto } from "./pisteyta.js";
import { TAPAUKSET } from "./tapaukset.js";

export const MAX_KUTSUJA = 40;          // kova katto yhdelle elavalle nauhoitukselle
export const NAUHAHAKEMISTO = path.join(path.dirname(fileURLToPath(import.meta.url)), "nauhat");
const FAKE_BASE = "https://llm.example/v1";

/** Kayttovirhe: viesti on oma vakioteksti (ei syotetta eika salaisuuksia), joten sen saa tulostaa. */
class KayttoVirhe extends Error {}

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
/** Pyynnon tiiviste: malli ei vaikuta (sama nauha voidaan toistaa), system- ja user-viesti vaikuttavat. */
export const pyyntoTiiviste = (body) => sha256(`${body.messages[0].content}\n\u0000\n${body.messages[1].content}`);

/**
 * Ajaa yhden tapauksen run()-polun lapi.
 * vastaa(body) -> {content} | {puuttuu: true}  (toisto ja keinomalli), tai live = {base, apiKey}.
 * @returns {{review, virhe, raaka, tiiviste, usage}}
 */
export async function ajaTapaus(tapaus, { malli, vastaa, live }) {
  let raaka = null;
  let tiiviste = null;
  let usage = null;
  let puuttuu = false;
  const net = fakeNet({
    files: tapaus.tiedostot,
    reply: (body) => {
      tiiviste = pyyntoTiiviste(body);
      const v = vastaa(body);
      if (v.puuttuu) puuttuu = true;
      raaka = v.content ?? "";
      return raaka;
    },
  });
  const llmBase = live?.base ?? FAKE_BASE;
  const env = baseEnv({
    GITHUB_EVENT_PATH: eventFile({ title: tapaus.otsikko }),
    "INPUT_BASE-URL": llmBase,
    INPUT_MODEL: malli,
    "INPUT_DRY-RUN": "true",
    ...(live ? { "INPUT_API-KEY": live.apiKey } : {}),
  });
  const fetchImpl = live
    ? async (url, init) => {
        if (!String(url).startsWith(`${llmBase}/`)) return net.fetchImpl(url, init);
        tiiviste = pyyntoTiiviste(JSON.parse(init.body));
        const res = await fetch(url, init);
        try {
          const data = await res.clone().json();
          raaka = data?.choices?.[0]?.message?.content ?? null;
          const u = data?.usage;
          if (u && Number.isFinite(u.prompt_tokens)) usage = { input: u.prompt_tokens, output: u.completion_tokens };
        } catch { raaka = null; }
        return res;
      }
    : net.fetchImpl;
  let review = null;
  let virhe = null;
  try {
    const r = await run({ env, fetchImpl, log: { log() {} } });
    review = r.review ?? null;
    if (!review) virhe = r.outcome;
  } catch (e) {
    virhe = e?.code ?? e?.constructor?.name ?? "virhe"; // vain tyyppi/koodi, ei viestia
  }
  if (puuttuu) return { review: null, virhe: "nauha_puuttuu", raaka: null, tiiviste, usage };
  return { review, virhe, raaka, tiiviste, usage };
}

/** Toistaa nauhan: palauttaa tapausrivit ja yhteenvedon. Vanhentuneet ja puuttuvat tapaukset eivat ole pisteytyksessa. */
export async function toista(nauha, tapaukset = TAPAUKSET) {
  const rivit = [];
  const vanhentuneet = [];
  const puuttuvat = [];
  for (const t of tapaukset) {
    const n = nauha.vastaukset?.[t.id];
    if (!n) {
      puuttuvat.push(t.id);
      continue;
    }
    let tasmaa = true;
    const tulos = await ajaTapaus(t, {
      malli: nauha.malli,
      vastaa: (body) => {
        tasmaa = pyyntoTiiviste(body) === n.pyynto_sha256;
        return { content: n.content };
      },
    });
    if (!tasmaa) {
      vanhentuneet.push(t.id);
      continue;
    }
    rivit.push(pisteyta(t, tulos));
  }
  return { malli: nauha.malli, lahde: nauha.lahde, rivit, vanhentuneet, puuttuvat, yhteenveto: yhteenveto(rivit) };
}

/** Nauhoittaa kaikki tapaukset keinomallilla tai elavaa mallia vastaan. */
export async function nauhoita({ malli, lahde, keinomalli, live }, tapaukset = TAPAUKSET) {
  const vastaukset = {};
  for (const t of tapaukset) {
    const tulos = await ajaTapaus(t, {
      malli,
      live,
      vastaa: keinomalli ? (body) => ({ content: keinomalli(body, t) }) : undefined,
    });
    if (tulos.tiiviste == null) continue; // ei mallikutsua (esim. ei mitaan tarkastettavaa)
    vastaukset[t.id] = { pyynto_sha256: tulos.tiiviste, content: tulos.raaka, usage: tulos.usage, ...(tulos.virhe ? { virhe: tulos.virhe } : {}) };
  }
  return {
    muoto: "aprr-eval-nauha/1",
    malli, lahde,
    nauhoitettu: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    kehote_sha256: sha256(SYSTEM_PROMPT),
    max_output_tokens: DEFAULTS.maxOutputTokens,
    vastaukset,
  };
}

export function taulu(t) {
  const out = ["| tapaus | tila | osumat/odotetut | vaarat halytykset |", "|---|---|---|---|"];
  for (const r of t.rivit) {
    out.push(`| ${r.id} | ${r.tila}${r.virhe ? ` (${r.virhe})` : ""} | ${r.osumat}/${r.odotettuja} | ${r.vaarat}${r.vaaratLoydokset?.length ? ` (${r.vaaratLoydokset.join(", ")})` : ""} |`);
  }
  return out.join("\n");
}

function args(argv) {
  const a = { nauhat: [] };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--nauha") a.nauhat.push(argv[++i]);
    else if (k === "--nauhoita") a.nauhoita = true;
    else if (k === "--keinomalli") a.keinomalli = argv[++i];
    else if (k === "--base-url") a.baseUrl = argv[++i];
    else if (k === "--malli") a.malli = argv[++i];
    else if (k === "--ulos") a.ulos = argv[++i];
    else if (k === "--tiukka") a.tiukka = true;
    else if (k === "--json") a.json = true;
    else throw new KayttoVirhe("tuntematon valitsin");
  }
  return a;
}

async function main() {
  const a = args(process.argv);
  if (a.nauhoita) {
    let nauha;
    if (a.keinomalli) {
      const km = KEINOMALLIT[a.keinomalli];
      if (!km) throw new KayttoVirhe("tuntematon keinomalli");
      nauha = await nauhoita({ malli: `keinomalli-${a.keinomalli}`, lahde: "keinomalli", keinomalli: km });
    } else {
      if (!a.baseUrl || !a.malli) throw new KayttoVirhe("kayta --keinomalli NIMI tai --base-url URL --malli NIMI");
      const apiKey = process.env.LLM_API_KEY ?? "";
      if (!apiKey) throw new KayttoVirhe("LLM_API_KEY puuttuu ymparistosta");
      if (TAPAUKSET.length > MAX_KUTSUJA) throw new KayttoVirhe("liikaa kutsuja");
      nauha = await nauhoita({ malli: a.malli, lahde: "elava", live: { base: checkBaseUrl(a.baseUrl), apiKey } });
    }
    const ulos = a.ulos ?? path.join(NAUHAHAKEMISTO, `${nauha.malli.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
    fs.writeFileSync(ulos, `${JSON.stringify(nauha, null, 1)}\n`);
    console.log(`nauhoitettu ${Object.keys(nauha.vastaukset).length} vastausta: ${ulos}`);
    return 0;
  }
  const tiedostot = a.nauhat.length
    ? a.nauhat
    : fs.readdirSync(NAUHAHAKEMISTO).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(NAUHAHAKEMISTO, f));
  let ongelmia = 0;
  const kaikki = [];
  for (const f of tiedostot) {
    const t = await toista(JSON.parse(fs.readFileSync(f, "utf8")));
    ongelmia += t.vanhentuneet.length + t.puuttuvat.length;
    kaikki.push(t);
    if (a.json) continue;
    console.log(`\n## ${t.malli} (${t.lahde}; ${path.basename(f)})\n\n${taulu(t)}\n`);
    console.log(JSON.stringify(t.yhteenveto));
    if (t.vanhentuneet.length) console.log(`vanhentuneet (kehote tai tapaus muuttui, nauhoita uudelleen): ${t.vanhentuneet.join(", ")}`);
    if (t.puuttuvat.length) console.log(`puuttuvat: ${t.puuttuvat.join(", ")}`);
  }
  if (a.json) console.log(JSON.stringify(kaikki.map(({ malli, lahde, yhteenveto: y, vanhentuneet, puuttuvat }) => ({ malli, lahde, ...y, vanhentuneet, puuttuvat })), null, 1));
  return a.tiukka && ongelmia > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((c) => { process.exitCode = c; }, (e) => { console.error(e instanceof KayttoVirhe ? `virhe: ${e.message}` : `virhe: ${e?.constructor?.name}`); process.exitCode = 1; });
}
