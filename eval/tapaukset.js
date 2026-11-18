// Laatumittarin tapaukset: pienia, itse kirjoitettuja diffeja, joissa on tunnettu vika tai ei vikaa.
// Kaikki koodi on kirjoitettu tata mittaria varten (ei kopioitu muista projekteista, ei yksityista koodia,
// ei salaisuuksia). Tiedosto on ASCII.
//
// Odotettu loydos = {file, line, avainsanat}. Loydos lasketaan osumaksi, kun tiedosto on sama, rivi on
// enintaan RIVITOLERANSSI paassa ja viestissa on ainakin yksi avainsanoista (pienilla kirjaimilla).

/**
 * Rakentaa GitHubin "patch"-merkkijonon ja laskee vikojen uudet rivinumerot.
 * @param {number} alku uuden tiedoston ensimmainen rivinumero (uusi tiedosto: 1)
 * @param {(string|[string, string])[]} rivit "+lisatty", " konteksti", "-poistettu"; [rivi, avain] merkitsee vian
 * @param {boolean} uusi true = uusi tiedosto (@@ -0,0 ...)
 */
export function patch(alku, rivit, uusi = false) {
  let rivi = alku;
  let vanhat = 0;
  let uudet = 0;
  const out = [];
  const viat = {};
  for (const x of rivit) {
    const [r, avain] = Array.isArray(x) ? x : [x];
    out.push(r);
    if (r.startsWith("-")) {
      vanhat += 1;
      continue;
    }
    if (avain) viat[avain] = rivi;
    if (r.startsWith(" ")) vanhat += 1;
    uudet += 1;
    rivi += 1;
  }
  const vanha = uusi ? "-0,0" : `-${alku},${vanhat}`;
  return { patch: `@@ ${vanha} +${alku},${uudet} @@\n${out.join("\n")}`, viat };
}

const uusiTiedosto = (filename, rivit) => {
  const p = patch(1, rivit.map((r) => (Array.isArray(r) ? [`+${r[0]}`, r[1]] : `+${r}`)), true);
  return { tiedosto: { filename, status: "added", patch: p.patch }, viat: p.viat };
};
const muokattu = (filename, alku, rivit) => {
  const p = patch(alku, rivit);
  return { tiedosto: { filename, status: "modified", patch: p.patch }, viat: p.viat };
};

function tapaus({ id, kuvaus, otsikko, osat, odotetut = [] }) {
  const viat = Object.assign({}, ...osat.map((o) => o.viat));
  return {
    id, kuvaus, otsikko,
    tiedostot: osat.map((o) => o.tiedosto),
    puhdas: odotetut.length === 0,
    odotetut: odotetut.map((o) => {
      if (!(o.avain in viat)) throw new Error(`tapaus ${id}: tuntematon vika-avain ${o.avain}`);
      return { file: o.file, line: viat[o.avain], avainsanat: o.avainsanat };
    }),
  };
}

export const RIVITOLERANSSI = 1;

const SQL = ["sql", "injection", "concatenat", "parameter", "sanitiz", "escap"];
const KOMENTO = ["command injection", "shell", "injection", "sanitiz", "escap"];
const OHI = ["off-by-one", "off by one", "out of bounds", "out-of-bounds", "past the end", "undefined", "<=", "bound"];
const NULL = ["null", "undefined", "not found", "missing", "check"];

export const TAPAUKSET = [
  tapaus({
    id: "vika-01-sql-ketjutus", kuvaus: "SQL-kysely rakennetaan merkkijonoja yhdistamalla",
    otsikko: "Add user lookup by email",
    osat: [uusiTiedosto("src/users.js", [
      "export async function findByEmail(db, email) {",
      ["  const rows = await db.query(\"SELECT id, name FROM users WHERE email = '\" + email + \"'\");", "sql"],
      "  return rows[0] ?? null;",
      "}",
    ])],
    odotetut: [{ file: "src/users.js", avain: "sql", avainsanat: SQL }],
  }),
  tapaus({
    id: "vika-02-silmukka-yli", kuvaus: "Silmukan raja <= length lukee taulukon ohi",
    otsikko: "Sum order totals",
    osat: [uusiTiedosto("src/orders.js", [
      "export function total(orders) {",
      "  let sum = 0;",
      ["  for (let i = 0; i <= orders.length; i++) {", "ohi"],
      "    sum += orders[i].amount;",
      "  }",
      "  return sum;",
      "}",
    ])],
    odotetut: [{ file: "src/orders.js", avain: "ohi", avainsanat: OHI }],
  }),
  tapaus({
    id: "vika-03-null-tarkistus", kuvaus: "find() voi palauttaa undefined, jonka kenttaa luetaan",
    otsikko: "Show the owner's display name",
    osat: [muokattu("src/projects.js", 10, [
      " export function ownerName(project, users) {",
      "-  return project.ownerName;",
      "+  const owner = users.find((u) => u.id === project.ownerId);",
      ["+  return owner.displayName;", "null"],
      " }",
    ])],
    odotetut: [{ file: "src/projects.js", avain: "null", avainsanat: NULL }],
  }),
  tapaus({
    id: "vika-04-komentoinjektio", kuvaus: "Kayttajan syote menee shell-komentoon",
    otsikko: "Add archive endpoint",
    osat: [uusiTiedosto("src/archive.js", [
      "import { execSync } from \"node:child_process\";",
      "",
      "export function archive(req, res) {",
      "  const name = req.query.name;",
      ["  execSync(`tar czf /tmp/${name}.tgz /srv/data/${name}`);", "cmd"],
      "  res.send(\"ok\");",
      "}",
    ])],
    odotetut: [{ file: "src/archive.js", avain: "cmd", avainsanat: KOMENTO }],
  }),
  tapaus({
    id: "vika-05-polku-ohitus", kuvaus: "Kayttajan antama tiedostonimi liitetaan polkuun ilman rajausta",
    otsikko: "Serve uploaded files",
    osat: [uusiTiedosto("src/files.js", [
      "import fs from \"node:fs\";",
      "import path from \"node:path\";",
      "",
      "export function download(req, res) {",
      ["  const file = path.join(\"/srv/uploads\", req.params.name);", "polku"],
      "  res.send(fs.readFileSync(file));",
      "}",
    ])],
    odotetut: [{ file: "src/files.js", avain: "polku", avainsanat: ["traversal", "../", "directory", "path", "sanitiz", "outside"] }],
  }),
  tapaus({
    id: "vika-06-await-puuttuu", kuvaus: "Async-funktiota ei odoteta, joten virhe ja tulos katoavat",
    otsikko: "Save settings before redirect",
    osat: [muokattu("src/settings.js", 20, [
      " export async function saveAndGo(store, settings, go) {",
      ["+  store.save(settings);", "await"],
      "   go(\"/home\");",
      " }",
    ])],
    odotetut: [{ file: "src/settings.js", avain: "await", avainsanat: ["await", "promise", "async", "race"] }],
  }),
  tapaus({
    id: "vika-07-py-oletuslista", kuvaus: "Pythonin muuttuva oletusargumentti jaetaan kutsujen kesken",
    otsikko: "Collect tags",
    osat: [uusiTiedosto("app/tags.py", [
      ["def add_tag(tag, tags=[]):", "oletus"],
      "    tags.append(tag)",
      "    return tags",
    ])],
    odotetut: [{ file: "app/tags.py", avain: "oletus", avainsanat: ["mutable", "default", "shared"] }],
  }),
  tapaus({
    id: "vika-08-py-nollalla-jako", kuvaus: "Tyhja lista aiheuttaa nollalla jaon",
    otsikko: "Average response time",
    osat: [uusiTiedosto("app/stats.py", [
      "def average(times):",
      ["    return sum(times) / len(times)", "jako"],
    ])],
    odotetut: [{ file: "app/stats.py", avain: "jako", avainsanat: ["zero", "empty", "zerodivision"] }],
  }),
  tapaus({
    id: "vika-09-py-niellyt-virheet", kuvaus: "Paljas except nielee kaikki virheet ja palauttaa vaaran arvon",
    otsikko: "Load config safely",
    osat: [uusiTiedosto("app/config.py", [
      "import json",
      "",
      "def load(path):",
      "    try:",
      "        with open(path) as f:",
      "            return json.load(f)",
      ["    except:", "except"],
      "        return {}",
    ])],
    odotetut: [{ file: "app/config.py", avain: "except", avainsanat: ["except", "swallow", "silent", "hide", "error"] }],
  }),
  tapaus({
    id: "vika-10-sijoitus-ehdossa", kuvaus: "Ehdossa on sijoitus (=) vertailun sijaan",
    otsikko: "Skip admins in cleanup",
    osat: [muokattu("src/cleanup.js", 5, [
      " export function shouldDelete(user) {",
      ["+  if (user.role = \"admin\") return false;", "sij"],
      "   return user.inactiveDays > 365;",
      " }",
    ])],
    odotetut: [{ file: "src/cleanup.js", avain: "sij", avainsanat: ["assign", "===", "==", "comparison"] }],
  }),
  tapaus({
    id: "vika-11-fetch-tila", kuvaus: "HTTP-vastauksen tilaa ei tarkisteta ennen JSON-jasennysta",
    otsikko: "Fetch exchange rates",
    osat: [uusiTiedosto("src/rates.js", [
      "export async function rates(fetchImpl) {",
      ["  const res = await fetchImpl(\"https://rates.example.invalid/latest\");", "tila"],
      "  const data = await res.json();",
      "  return data.rates;",
      "}",
    ])],
    odotetut: [{ file: "src/rates.js", avain: "tila", avainsanat: ["status", "res.ok", "error", "check"] }],
  }),
  tapaus({
    id: "vika-12-kaksi-vikaa", kuvaus: "Kaksi vikaa samassa diffissa: eval kayttajan syotteelle ja sivutus ohi yhdella",
    otsikko: "Calculator endpoint and paging",
    osat: [
      uusiTiedosto("src/calc.js", [
        "export function calc(req, res) {",
        ["  res.json({ value: eval(req.body.expr) });", "eval"],
        "}",
      ]),
      uusiTiedosto("src/page.js", [
        "export function page(items, n, size) {",
        ["  return items.slice(n * size, n * size + size + 1);", "sivu"],
        "}",
      ]),
    ],
    odotetut: [
      { file: "src/calc.js", avain: "eval", avainsanat: ["eval", "code execution", "injection", "arbitrary"] },
      { file: "src/page.js", avain: "sivu", avainsanat: ["off-by-one", "off by one", "extra", "one more", "+ 1", "+1", "overlap"] },
    ],
  }),
  tapaus({
    id: "puhdas-01-parametrit", kuvaus: "Parametrisoitu kysely (ei SQL-injektiota)",
    otsikko: "Add user lookup by id",
    osat: [uusiTiedosto("src/users-by-id.js", [
      "export async function findById(db, id) {",
      "  const rows = await db.query(\"SELECT id, name FROM users WHERE id = $1\", [id]);",
      "  return rows[0] ?? null;",
      "}",
    ])],
  }),
  tapaus({
    id: "puhdas-02-silmukka-oikein", kuvaus: "Silmukka 1..length ja indeksi i - 1 on oikein (sudenkuoppa saannoille)",
    otsikko: "Number the lines",
    osat: [uusiTiedosto("src/numbered.js", [
      "export function numbered(lines) {",
      "  const out = [];",
      "  for (let i = 1; i <= lines.length; i++) {",
      "    out.push(`${i}: ${lines[i - 1]}`);",
      "  }",
      "  return out;",
      "}",
    ])],
  }),
  tapaus({
    id: "puhdas-03-uudelleennimeays", kuvaus: "Pelkka muuttujan uudelleennimeays",
    otsikko: "Rename total to grandTotal",
    osat: [muokattu("src/invoice.js", 30, [
      " export function summary(lines) {",
      "-  const total = lines.reduce((a, l) => a + l.price * l.qty, 0);",
      "-  return { total };",
      "+  const grandTotal = lines.reduce((a, l) => a + l.price * l.qty, 0);",
      "+  return { total: grandTotal };",
      " }",
    ])],
  }),
  tapaus({
    id: "puhdas-04-dokumentaatio", kuvaus: "Pelkkaa dokumentaatiota (oikea vastaus: ei loydoksia tai unknown)",
    otsikko: "Document the release process",
    osat: [uusiTiedosto("docs/RELEASE.md", [
      "# Release",
      "",
      "1. Update CHANGELOG.md.",
      "2. Tag the commit: `git tag v1.2.3`.",
      "3. Push the tag. CI publishes the release.",
    ])],
  }),
  tapaus({
    id: "puhdas-05-py-tarkistettu", kuvaus: "Tyhja lista kasitelty ennen jakoa",
    otsikko: "Safe average",
    osat: [uusiTiedosto("app/safe_stats.py", [
      "def average(times):",
      "    if not times:",
      "        return 0.0",
      "    return sum(times) / len(times)",
    ])],
  }),
];
