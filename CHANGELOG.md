# Muutosloki

## Julkaisematon

Muutokset, jotka ovat masterissa tagin v0.1.2 jälkeen mutta eivät vielä julkaistussa versiossa.

Korjattu (tietoturva):

- PR:n otsikko siirrettiin `<data>`-lohkon sisään rivin `PR TITLE:` alle. Aiemmin otsikko lähetettiin lohkon ulkopuolella, vaikka sen kirjoittaa PR:n tekijä. Nyt se normalisoidaan ja puhdistetaan (defang) kuten diff, ja järjestelmäkehote kertoo, että myös otsikkorivi on epäluotettavaa tekstiä. Uusi testi varmistaa, että otsikkoon upotettu `</data>` ei sulje lohkoa (234d9c0).
- Virheellinen `base-url` (http-osoite, jäsentymätön osoite tai osoite, jossa on tunnus ja salasana) hylätään nyt ennen ajokerran varausta. Aiemmin tarkistus tehtiin vasta varauksen jälkeen, joten virheellinen osoite saattoi jättää varauskommentin ja kuluttaa ajokerran. Uusi testi varmistaa, ettei kommenttia, mallikutsua eikä GitHub-kirjoitusta synny (3548b42).

Lisätty:

- Uusi valinnainen syöte `context-lines` (oletus 0 = pois, enintään 20). Kun arvo on suurempi kuin 0, jokaisen muutoslohkon ympärille liitetään enintään näin monta muuttumatonta riviä molemmin puolin. Rivit luetaan head-commitista contents-rajapinnalla (vain GET, enintään 20 tiedostoa ajoa kohden) ja merkitään kehotteessa kontekstiksi. Tausta: tarkastaja näki pelkän patchin ja saattoi hylätä koodin sillä perusteella, että funktio näytti katkeavan.
- Kontekstirivit lasketaan `max-input-tokens`-katon sisään ja siivotaan (`redact`) kuten diff. Jos ne eivät mahdu, luku epäonnistuu tai tiedoston sisältö ei vastaa patchia, tiedosto tarkistetaan pelkällä patchilla. Lokiin kirjataan vain virheen tyyppi ja HTTP-tila.
- Oletus 0 ei muuta kehotetta eikä pyyntöjä lainkaan. Järjestelmäkehotteeseen lisätään kontekstia koskeva huomautus vain, jos jokin tiedosto sai kontekstia.
- Rajat: `limits.js`:n olemassa olevia arvoja ei muutettu. Uudet vakiot: `MAX_CONTEXT_LINES` (20), `MAX_CONTEXT_FILES` (20), `MAX_CONTEXT_LINE_CHARS` (400).

Muuta:

- Uusi laatumittari `eval/`: 17 itse kirjoitettua diffiä (13 tunnettua vikaa, 5 puhdasta diffiä), mekaaninen pisteytys ja tallennetut mallivastaukset (kasetit kansiossa `eval/cassettes/`), joten CI ei tee mallikutsuja. Tiedostot, tunnisteet ja tulosteet ovat englanniksi (`eval/run.js`, `eval/score.js`, `eval/cases.js`, `eval/stub-models.js`). README:hen lisättiin osio Laatu. Kielimallia ei ole vielä mitattu: kasetit ovat kahdelta keinomallilta. Testejä on nyt 209, joista 208 menee läpi ja 1 on todo-tilassa.
- README on nyt englanniksi, ja suomenkielinen versio on tiedostossa `README.fi.md`. Kielivaihtolinkki on README:n alussa, ja testi 118 lukee Asetukset-taulukon molemmista tiedostoista ja tarkistaa versioviitteet myös `README.fi.md`:stä (a501ec0).
- Uudet rajatapaustestit `redact`-, `render`- ja `parseMarker`-toiminnoille (`test/edges.test.js`). Kaksi niistä on merkitty todo-tilaan tunnetuiksi aukoiksi: `;`-merkin jälkeinen osa arvosta ei peity, eikä pienellä kirjoitettu `bearer <token>` peity. README:n testimäärä on 179 (aiemmin 130) (00a3466).
- Offline-injektiosarjan tulokset lisättiin tiedostoon `injektio/RESULTS.md`, ja README viittaa niihin. Tulokset ovat kahdelta tekaistulta mallilta (koodia, ei kielimalleja), joten ne eivät kerro oikeiden mallien käytöksestä (1ecdf82).
- README:n kilpailijavertailun PR-Agent-linkki osoittaa uuteen osoitteeseen `The-PR-Agent/pr-agent` sekä englannin- että suomenkielisessä README:ssä (0933f2c).
- Kontekstirivin katkaisu 400 merkkiin pudottaa myös katkaisukohdassa kesken jääneen sanan, jotta katkennut salaisuus ei lähde mallille lukukelpoisena alkuna (`redact()` ei tunnista liian lyhyttä pätkää). Testi lisätty (`test/context.test.js`).

- Marketplace-valmius, osa 2: README-tiedostoihin uudet osiot Permissions/Oikeudet (tarvittavat oikeudet perusteluineen) ja Versioning and pinning/Versiointi ja kiinnitys (semver-tagit, SHA-kiinnitys, tuleva liikkuva `v1`-päätagi). Uusi `RELEASING.md` kertoo julkaisun tarkistuslistan ja Marketplace-julkaisun vaiheet. Kolme uutta testiä tarkistavat, ettei brändäyksen kuvake ole GitHubin poistamien Feather-kuvakkeiden joukossa, että README-tiedostojen oikeustaulukot vastaavat esimerkkiä ja että `SECURITY.md` nimeää `package.json`in version tuetuksi.

Testejä on 229 (tilanne 20.11.2026), joista 228 menee läpi ja 1 on todo-tilassa.

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
