# Muutosloki

## Julkaisematon

Muutokset, jotka ovat masterissa tagin v0.1.2 jälkeen mutta eivät vielä julkaistussa versiossa.

Korjattu (tietoturva):

- PR:n otsikko siirrettiin `<data>`-lohkon sisään rivin `PR TITLE:` alle. Aiemmin otsikko lähetettiin lohkon ulkopuolella, vaikka sen kirjoittaa PR:n tekijä. Nyt se normalisoidaan ja puhdistetaan (defang) kuten diff, ja järjestelmäkehote kertoo, että myös otsikkorivi on epäluotettavaa tekstiä. Uusi testi varmistaa, että otsikkoon upotettu `</data>` ei sulje lohkoa (234d9c0).
- Virheellinen `base-url` (http-osoite, jäsentymätön osoite tai osoite, jossa on tunnus ja salasana) hylätään nyt ennen ajokerran varausta. Aiemmin tarkistus tehtiin vasta varauksen jälkeen, joten virheellinen osoite saattoi jättää varauskommentin ja kuluttaa ajokerran. Uusi testi varmistaa, ettei kommenttia, mallikutsua eikä GitHub-kirjoitusta synny (3548b42).
- Redaktion `Bearer`-sääntö tunnistaa nyt tunnuksen kirjainkoosta riippumatta (`Bearer`, `bearer`, `BEARER`). Aiemmin vain isolla alkukirjaimella kirjoitettu `Bearer` peittyi, vaikka HTTP:n Authorization-skeema on kirjainkoosta riippumaton (1f579df, #33).
- Redaktion sijoitusten tunnistus (`nimi=arvo`) ei enää peruuta neliöllisesti pitkillä avainnimen kaltaisilla sanoilla: se toimii kahdessa lineaarisessa vaiheessa, ja arvo luetaan vain, jos nimessä on salaisuussana. Ei-salainen nimi ei myöskään nielaise perässä tulevaa salaista sijoitusta (`user=bob&token=abcdef123`). Uudet testit kattavat pitkät sanat, ketjutetut sijoitukset ja arvot, joissa on `&` tai `=` (fc6a08d, #37).

Muuta:

- Uusi laatumittari `eval/`: 17 itse kirjoitettua diffiä (13 tunnettua vikaa, 5 puhdasta diffiä), mekaaninen pisteytys ja tallennetut mallivastaukset (kasetit kansiossa `eval/cassettes/`), joten CI ei tee mallikutsuja. Tiedostot, tunnisteet ja tulosteet ovat englanniksi (`eval/run.js`, `eval/score.js`, `eval/cases.js`, `eval/stub-models.js`). README:hen lisättiin osio Laatu. Kielimallia ei ole vielä mitattu: kasetit ovat kahdelta keinomallilta. Testejä on nyt 209, joista 208 menee läpi ja 1 on todo-tilassa (33d1c3e, #42).
- README on nyt englanniksi, ja suomenkielinen versio on tiedostossa `README.fi.md`. Kielivaihtolinkki on README:n alussa, ja testi 118 lukee Asetukset-taulukon molemmista tiedostoista ja tarkistaa versioviitteet myös `README.fi.md`:stä (a501ec0).
- Uudet rajatapaustestit `redact`-, `render`- ja `parseMarker`-toiminnoille (`test/edges.test.js`). Kaksi niistä on merkitty todo-tilaan tunnetuiksi aukoiksi: `;`-merkin jälkeinen osa arvosta ei peity, eikä pienellä kirjoitettu `bearer <token>` peity (jälkimmäinen korjattiin myöhemmin, ks. Korjattu). README:n testimäärä on 179 (aiemmin 130) (00a3466, #32).
- Offline-injektiosarjan tulokset lisättiin tiedostoon `injektio/RESULTS.md`, ja README viittaa niihin. Tulokset ovat kahdelta tekaistulta mallilta (koodia, ei kielimalleja), joten ne eivät kerro oikeiden mallien käytöksestä (1ecdf82).
- README:n kilpailijavertailun PR-Agent-linkki osoittaa uuteen osoitteeseen `The-PR-Agent/pr-agent` sekä englannin- että suomenkielisessä README:ssä (0933f2c).

- Uusi `SECURITY.md`: tietoturvailmoitusten tekotapa (GitHubin yksityinen ilmoitus), tuetut versiot, uhkamalli taulukkona (suojaus ja lähdekoodin kohta) sekä tunnetut rajoitukset. Molemmat README-tiedostot viittaavat siihen (65892f2, #34).
- README-tiedostot vastaavat nyt yhdistettyjä muutoksia: Bearer-säännön kirjainkoko, lineaarinen sijoitusten tunnistus, viittaus `SECURITY.md`:hen ja `;`-merkin jälkeisen osan tunnettu aukko Rajoitukset-osiossa (0d4f0e3, #41).
- Marketplace-valmius, osa 2: README-tiedostoihin uudet osiot Permissions/Oikeudet (tarvittavat oikeudet perusteluineen) ja Versioning and pinning/Versiointi ja kiinnitys (semver-tagit, SHA-kiinnitys, tuleva liikkuva `v1`-päätagi). Uusi `RELEASING.md` kertoo julkaisun tarkistuslistan ja Marketplace-julkaisun vaiheet. Kolme uutta testiä tarkistavat, ettei brändäyksen kuvake ole GitHubin poistamien Feather-kuvakkeiden joukossa, että README-tiedostojen oikeustaulukot vastaavat esimerkkiä ja että `SECURITY.md` nimeää `package.json`in version tuetuksi (a1cecc2, #43).

Testejä on 198 (tilanne 19.11.2026), joista 197 menee läpi ja 1 on todo-tilassa.

## 0.1.2 (6.11.2026)

Korjattu (tietoturva):

- Redaktio tunnistaa nyt myös lainatut avainnimet (esim. `"api_key": "..."`), joten lainausmerkeissä oleva salaisuus ei enää päädy malliin (e840a99).
- Tiedostonimi puhdistetaan (defang) ennen kehotteeseen liittämistä, jotta nimeen upotettu ohje ei pääse rikkomaan `<data>`-lohkoa (e840a99).
- Ohitettavien tiedostojen luetteloon lisättiin salaisuustyyppejä: `credentials.json`, `secrets.yml`, `.npmrc`, `.netrc`, `.htpasswd`, `*.tfvars`, `*.tfstate`, `*.jks`, `*.keystore`, `*.p8`, `*.kdbx` (e840a99).
- Ajokerta varataan ennen mallikutsua. Jos kommentin kirjoitus epäonnistuu (esim. `pull-requests: write` puuttuu), työ päättyy ennen maksullista kutsua (8b72e01).
- Syöttökattoon lasketaan järjestelmäkehotteen todellinen pituus kiinteän arvion sijaan (8b72e01).
- Turvallisuus: syöte normalisoidaan ennen erottimen tarkistusta (näkymättömät merkit ja Unicode tag -merkit pois, NFKC, leveät ja koristeelliset kulmasulut tavallisiksi). Sulkee kolme PR #12:ssa kirjattua aukkoa.

Muuta:

- Marketplace-valmius: `action.yml`:n nimi on "Budgeted AI PR Reviewer", kuvaus on alle 125 merkkiä, ja esimerkin versioviite (`examples/review.yml`) on `@v0.1.2`. Uudet testit tarkistavat nimen, kuvauksen pituuden, brändäyksen ja versioviitteet.
- CI: Dependabotin patch/minor-päivitykset yhdistetään automaattisesti (major jää ihmiselle).
- README: englanninkielinen pikaohje, testimäärä (130) ja versioviittaus `@v0.1.2`.

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
