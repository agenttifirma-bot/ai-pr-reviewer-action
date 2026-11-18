# Laatumittari

Mittaa, löytääkö tarkastaja tunnetut viat ja montako väärää hälytystä se antaa. Luvut lasketaan tallennetuista mallivastauksista (nauhoista), joten sama ajo antaa aina samat luvut eikä CI tee mallikutsuja.

**English summary:** A repeatable quality metric. 17 small hand-written diffs (12 with 13 known defects, 5 clean) are pushed through the real `run()` path with a faked GitHub. Model replies come from cassettes in `eval/nauhat/`, so CI makes no model calls. A finding is a hit when the file matches, the line is within 1 and the message contains one of the expected keywords. Reported: defects found (recall), precision, false alarms, clean diffs without findings. Recording a real model needs your own key and is never done in CI.

## Tiedostot

| Tiedosto | Sisältö |
|---|---|
| `tapaukset.js` | 17 tapausta: diff, PR:n otsikko ja odotetut löydökset (tiedosto, rivi, avainsanat) |
| `pisteyta.js` | osumat, ohitukset, väärät hälytykset, kaksoiskappaleet ja yhteenveto |
| `keinomallit.js` | `saantopohja` (7 säännöllistä lauseketta) ja `viite` (palauttaa odotetut vastaukset) |
| `aja.js` | toisto ja nauhoitus |
| `nauhat/*.json` | tallennetut vastaukset, yksi tiedosto per malli |

Kaikki diffit on kirjoitettu tätä mittaria varten. Niissä ei ole yksityistä koodia eikä salaisuuksia.

## Tapaukset

Viat: SQL-kysely merkkijonoista, silmukka `<= length`, tarkistamaton `find()`-tulos, komentoinjektio, polun ohitus, puuttuva `await`, Pythonin muuttuva oletusargumentti, nollalla jako, paljas `except`, sijoitus ehdossa, tarkistamaton HTTP-tila sekä yksi diffi, jossa on kaksi vikaa (`eval` ja sivutus yhden yli).

Puhtaat: parametrisoitu kysely, oikein toimiva `1..length`-silmukka (sudenkuoppa säännöille), uudelleennimeäys, pelkkä dokumentaatio ja tarkistettu jako. Puhtaassa diffissä vastaus "unknown" ei ole virhe.

## Pisteytys

- **Osuma:** sama tiedosto, rivi enintään 1 rivin päässä ja viestissä jokin odotetuista avainsanoista.
- **Väärä hälytys:** löydös, joka ei osu mihinkään odotettuun vikaan.
- **Kaksoiskappale:** toinen löydös jo löydettyyn vikaan. Ei osuma eikä väärä hälytys.
- **Kattavuus** = osumat / odotetut viat. **Tarkkuus** = osumat / (osumat + väärät hälytykset).
- `pudotetut` on Actionin oma luku: löydökset, joiden rivi ei ollut näytetty lisätty rivi.

Avainsanahaku on karkea. Oikea löydös voi jäädä osumatta, jos malli kuvaa vian sanoilla, joita listassa ei ole. Tarkista väärät hälytykset käsin ennen kuin julkaiset mallin luvun.

## Ajaminen

```bash
node eval/aja.js               # toistaa kaikki nauhat, ei verkkoa, ei kuluja
node eval/aja.js --tiukka      # paluuarvo 1, jos jokin nauha on vanhentunut tai vajaa
node eval/aja.js --json        # yhteenveto koneluettavana
npm test                       # testit tarkistavat myös, että README:n luvut vastaavat nauhaa
```

Keinomallien nauhat luodaan uudelleen näin (esimerkiksi kehotteen muutoksen jälkeen):

```bash
node eval/aja.js --nauhoita --keinomalli saantopohja
node eval/aja.js --nauhoita --keinomalli viite
```

## Oikean mallin nauhoitus (paikallisesti, oma avain)

```bash
LLM_API_KEY=... node eval/aja.js --nauhoita --base-url https://api.example.com/v1 --malli MALLIN-NIMI
node eval/aja.js --nauha eval/nauhat/MALLIN-NIMI.json
```

- Yksi kutsu per tapaus (17), kova katto `MAX_KUTSUJA` = 40. Kutsu on sama kuin Actionissa: `temperature` 0 ja oletuksena `max_tokens` 1500.
- Avain luetaan vain ympäristömuuttujasta. Sitä ei tulosteta eikä tallenneta nauhaan (testattu).
- `--base-url` hyväksyy vain https-osoitteen tai localhostin, kuten Action.
- Nauhaan tallentuu mallin raakavastaus, käyttömäärät ja pyynnön SHA-256-tiiviste. Lue nauha ennen committia.

## Vanhentuneet nauhat

Nauha tallentaa tiivisteen järjestelmäkehotteesta ja käyttäjäviestistä. Jos kehote, diffi tai otsikko muuttuu, tiiviste ei täsmää ja tapaus merkitään vanhentuneeksi. Vanhentunutta tapausta ei pisteytetä, koska vastaus koskee eri pyyntöä. Testi vaatii, että kaikki commitoidut nauhat ovat ajan tasalla.

## Rajoitukset

- 17 tapausta on pieni otos. Yksi tapaus muuttaa kattavuutta noin 8 prosenttiyksikköä.
- Diffit ovat pieniä ja vika on selvä. Oikeissa PR:issä on enemmän kontekstia ja vähemmän ilmeisiä vikoja.
- Keinomallien luvut eivät kerro mitään kielimallin laadusta.
