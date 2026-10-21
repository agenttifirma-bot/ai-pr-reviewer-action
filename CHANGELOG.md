# Muutosloki

## Julkaisematon

- CI: Dependabotin patch/minor-päivitykset yhdistetään automaattisesti (major jää ihmiselle).
- README: englanninkielinen pikaohje (käyttö, asetukset, turvallisuus lyhyesti).

## 0.1.1 (17.10.2026)

Ensimmäinen oikea mallikokeilu (OpenRouter, `deepseek/deepseek-chat`, demo-PR jossa viisi tahallista virhettä):

- Ajo 1-2 (alkuperäinen kehote): malli vastasi molemmilla kerroilla "en tiedä" (noin 850 tokenia sisään, 50 ulos). Kehote kehotti liian helposti kieltäytymään.
- Ajo 3 (kehote tiukennettu: "älä vastaa unknown pelkästään siksi, ettet näe koko repoa"): malli vastasi "ei löydöksiä", vaikka virheet olivat näkyvissä.
- Ajo 4 (kehotteeseen lisätty `analysis`-kenttä, jossa malli käy koodin läpi ennen löydöksiä): 3 oikeaa löydöstä oikeilta riveiltä (SQL-injektio, komentoinjektio, silmukan `<=`-virhe). 1969 tokenia sisään, 256 ulos.
- Jäi löytämättä: `JSON.parse`-tuloksen käyttö ilman tarkistusta. Kovakoodattu salasana ei päässyt malliin asti, koska salaisuuksien siivous poisti sen ennen lähetystä (suunnitellusti).
- Yhden mallin ja yhden PR:n kokemus, ei vertailua. Mallin vaihto muuttaa tulosta.
- `analysis`-kenttä ei näy kommentissa eikä vaikuta validointiin.

## 0.1.0 (17.10.2026)

- Ensimmäinen versio: yksi yhteenvetokommentti per PR, päivitetään paikallaan.
- Kova tokenkatto (`max-input-tokens`, `max-output-tokens`) ja ajokerrat per PR (`max-runs-per-pr`); tiedostot, jotka eivät mahdu, listataan.
- Salaisuuksien siivous, `.env`/avain/lukko/binääritiedostojen ohitus, `<data>`-lohko, mallin tekstin puhdistus.
- Löydös hyväksytään vain lisätylle riville, jonka malli näki; `unknown`-vastaus tuettu.
- Kieltäytyy `pull_request_target`-tapahtumasta; ei tee mitään ilman `api-key`:tä (fork-PR).
- Ei ajonaikaisia riippuvuuksia; testit ilman verkkoa.
- Ei vielä ajettu oikealla mallilla: ensimmäinen oikea kokeilu tehdään erikseen ja kirjataan tähän.
