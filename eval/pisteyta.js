// Pisteytys: tarkastajan loydokset verrataan odotettuihin. Mekaaninen (tiedosto + rivi + avainsana), ei mallin arvio.
import { RIVITOLERANSSI } from "./tapaukset.js";

/** Osuuko loydos odotettuun: sama tiedosto, rivi toleranssin sisalla, viestissa jokin avainsana. */
export function osuu(loydos, odotettu, toleranssi = RIVITOLERANSSI) {
  if (loydos.file !== odotettu.file) return false;
  if (Math.abs(loydos.line - odotettu.line) > toleranssi) return false;
  const viesti = String(loydos.message ?? "").toLowerCase();
  return odotettu.avainsanat.some((s) => viesti.includes(s.toLowerCase()));
}

/**
 * @param tapaus tapaukset.js:n tapaus
 * @param tulos  {review: {result, findings, dropped}|null, virhe: string|null}
 * @returns {{id, puhdas, tila, osumat, ohitetut, vaarat, kaksoiskappaleet, pudotetut}}
 *  tila: "ok" | "unknown" | "virhe"
 *  vaarat: loydokset, jotka eivat osu mihinkaan odotettuun (vaarat halytykset)
 *  kaksoiskappaleet: toinen loydos samaan jo loydettyyn vikaan (ei vaara halytys, ei uusi osuma)
 */
export function pisteyta(tapaus, tulos) {
  const pohja = { id: tapaus.id, puhdas: tapaus.puhdas, odotettuja: tapaus.odotetut.length, pudotetut: 0, kaksoiskappaleet: 0 };
  if (!tulos.review) return { ...pohja, tila: "virhe", virhe: tulos.virhe ?? "virhe", osumat: 0, ohitetut: tapaus.odotetut.length, vaarat: 0, vaaratLoydokset: [] };
  const r = tulos.review;
  if (r.result === "unknown") return { ...pohja, tila: "unknown", osumat: 0, ohitetut: tapaus.odotetut.length, vaarat: 0, vaaratLoydokset: [] };
  const loydetty = new Set();
  let kaksoiskappaleet = 0;
  const vaaratLoydokset = [];
  for (const f of r.findings) {
    const i = tapaus.odotetut.findIndex((o, j) => !loydetty.has(j) && osuu(f, o));
    if (i >= 0) {
      loydetty.add(i);
      continue;
    }
    if (tapaus.odotetut.some((o) => osuu(f, o))) kaksoiskappaleet += 1;
    else vaaratLoydokset.push(`${f.file}:${f.line}`);
  }
  return {
    ...pohja, tila: "ok", pudotetut: r.dropped ?? 0, kaksoiskappaleet,
    osumat: loydetty.size, ohitetut: tapaus.odotetut.length - loydetty.size,
    vaarat: vaaratLoydokset.length, vaaratLoydokset,
  };
}

const osuus = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);

/** Kokonaisluvut tapausriveista. */
export function yhteenveto(rivit) {
  const sum = (k) => rivit.reduce((a, r) => a + (r[k] ?? 0), 0);
  const osumat = sum("osumat");
  const odotettuja = sum("odotettuja");
  const vaarat = sum("vaarat");
  const puhtaat = rivit.filter((r) => r.puhdas);
  const puhtaatHiljaa = puhtaat.filter((r) => r.tila !== "virhe" && r.vaarat === 0).length;
  return {
    tapauksia: rivit.length,
    odotettuja,
    osumat,
    ohitetut: sum("ohitetut"),
    vaarat_halytykset: vaarat,
    kaksoiskappaleet: sum("kaksoiskappaleet"),
    pudotetut: sum("pudotetut"),
    unknown: rivit.filter((r) => r.tila === "unknown").length,
    virheet: rivit.filter((r) => r.tila === "virhe").length,
    kattavuus: osuus(osumat, odotettuja),            // recall: loydetyt / odotetut viat
    tarkkuus: osuus(osumat, osumat + vaarat),        // precision: osumat / (osumat + vaarat halytykset)
    puhtaat_hiljaa: `${puhtaatHiljaa}/${puhtaat.length}`, // puhtaat diffit ilman yhtaan vaaraa halytysta
  };
}
