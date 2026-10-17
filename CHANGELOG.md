# Muutosloki

## 0.1.0 (17.10.2026)

- Ensimmäinen versio: yksi yhteenvetokommentti per PR, päivitetään paikallaan.
- Kova tokenkatto (`max-input-tokens`, `max-output-tokens`) ja ajokerrat per PR (`max-runs-per-pr`); tiedostot, jotka eivät mahdu, listataan.
- Salaisuuksien siivous, `.env`/avain/lukko/binääritiedostojen ohitus, `<data>`-lohko, mallin tekstin puhdistus.
- Löydös hyväksytään vain lisätylle riville, jonka malli näki; `unknown`-vastaus tuettu.
- Kieltäytyy `pull_request_target`-tapahtumasta; ei tee mitään ilman `api-key`:tä (fork-PR).
- Ei ajonaikaisia riippuvuuksia; testit ilman verkkoa.
- Ei vielä ajettu oikealla mallilla: ensimmäinen oikea kokeilu tehdään erikseen ja kirjataan tähän.
