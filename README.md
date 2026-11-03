# ai-pr-reviewer-action

[![CI](https://github.com/tonyweckstrom1987/ai-pr-reviewer-action/actions/workflows/ci.yml/badge.svg)](https://github.com/tonyweckstrom1987/ai-pr-reviewer-action/actions/workflows/ci.yml) ![Lisenssi: MIT](https://img.shields.io/badge/lisenssi-MIT-blue.svg)

GitHub Action, joka kirjoittaa pull requestista yhden tekoälykommentin, jolla on kova tokenkatto, selvä "en tiedä" -vastaus eikä pääsyä PR:n koodiin tai salaisuuksiin. Toimii minkä tahansa OpenAI-yhteensopivan osoitteen kanssa (OpenRouter, LiteLLM, OpenAI ym.).

**English summary:** A GitHub Action that posts one AI review comment per pull request with a hard token ceiling, an explicit "I do not know" answer, and no access to PR code or secrets. It never checks out or runs PR code, sends only redacted diff text to any OpenAI-compatible endpoint, refuses `pull_request_target`, does nothing on fork PRs (no key), and only accepts findings that point at added lines the model was actually shown. Zero runtime dependencies, Node 24 runtime.

**Teknologiat:** JavaScript (ESM), Node.js 22/24, `node:test`. Ei ajonaikaisia riippuvuuksia.

## Quick start (English)

Add the workflow from [`examples/review.yml`](examples/review.yml) to `.github/workflows/` and store the model key as the secret `LLM_API_KEY`:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: tonyweckstrom1987/ai-pr-reviewer-action@v0.1.1
        with:
          api-key: ${{ secrets.LLM_API_KEY }}
          base-url: https://openrouter.ai/api/v1
          model: deepseek/deepseek-chat
```

The Action does no `checkout`: it reads the changed files through the GitHub API and posts **one** comment, updated in place.

| Input | Default | Meaning |
| --- | --- | --- |
| `api-key` | empty | Model key. Fork PRs get no secrets, so the Action then does nothing. |
| `base-url` | required | OpenAI-compatible endpoint, `https` only. |
| `model` | required | Model name. |
| `github-token` | `${{ github.token }}` | Token for reading the PR files and writing one comment. The default is enough; override only if you need a different token. |
| `max-input-tokens` | 20000 | Ceiling for the *estimated* input (max 100000; 3 characters per token, which holds for typical code and English but under-counts non-ASCII text such as CJK or emoji, where the real count can be higher). As many files as fit, smallest first; the rest are listed as "Not reviewed". |
| `max-output-tokens` | 1500 | Hard ceiling for the reply (max 4000). |
| `max-runs-per-pr` | 5 | Reviews per pull request across all pushes (max 20). |
| `price-in`, `price-out` | 0 | USD per million tokens, only for the cost estimate in the comment. |
| `dry-run` | `false` | `true` prints the comment to the log instead of posting it. |
| `fail-on-error` | `false` | By default an error never blocks the PR. |

Safety in short: it refuses `pull_request_target`, never runs or writes PR code, redacts secret-like strings and skips `.env`, key, lock and binary files before anything is sent, wraps the diff as data without tools, and only keeps findings that point at added lines the model was actually shown. The model may answer `unknown`, and the comment then says so. The token ceilings and run limits live in code, not in the prompt. Details (in Finnish) are in the sections below. The model can be wrong; the check verifies the location of a finding, not whether the claim is true.

## Prompt injection -testisarja

Katso [`injektio/README.md`](injektio/README.md): 19 tapausta (OWASP LLM01/LLM06), kanariamittari ja ajuri, joka kirjaa tulokset `kokeilut.jsonl`-muotoon.

## Käyttö

Kopioi [`examples/review.yml`](examples/review.yml) repositoriosi kansioon `.github/workflows/` ja lisää salaisuus `LLM_API_KEY`:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: tonyweckstrom1987/ai-pr-reviewer-action@v0.1.1
        with:
          api-key: ${{ secrets.LLM_API_KEY }}
          base-url: https://openrouter.ai/api/v1
          model: deepseek/deepseek-chat
```

Action ei tee `checkout`-vaihetta eikä tarvitse sitä: se lukee muuttuneet tiedostot GitHubin rajapinnasta.

## Asetukset

| Asetus | Oletus | Merkitys |
| --- | --- | --- |
| `api-key` | (tyhjä) | Mallin avain. Fork-PR:issä GitHub ei anna salaisuuksia, jolloin Action ei tee mitään. |
| `base-url` | (pakollinen) | OpenAI-yhteensopiva osoite, vain `https`. |
| `model` | (pakollinen) | Mallin nimi. |
| `github-token` | `${{ github.token }}` | Token PR:n tiedostojen lukemiseen ja yhden kommentin kirjoittamiseen. Oletus riittää; vaihda vain jos tarvitset toisen tokenin. |
| `max-input-tokens` | 20 000 | Katto arvioidulle syötteelle (enintään 100 000). Arvio on 3 merkkiä/token, joka sopii koodille ja englannille mutta aliarvioi ei-ASCII-tekstin (esim. kiina, emoji), jolloin todellinen määrä voi ylittää arvion. Järjestelmäpromptin todellinen pituus lasketaan mukaan. Mahdollisimman monta tiedostoa pienimmästä alkaen; loput listataan kommentissa "Not reviewed". |
| `max-output-tokens` | 1 500 | Kova katto vastaukselle (enintään 4 000). |
| `max-runs-per-pr` | 5 | Montako kertaa yhtä PR:ää tarkistetaan kaikkien pushien yli (enintään 20). |
| `price-in`, `price-out` | 0 | Hinta dollareina miljoonaa tokenia kohden. Vain kustannusarvioon kommentin alariville. |
| `dry-run` | `false` | `true` tulostaa kommentin lokiin eikä julkaise sitä. |
| `fail-on-error` | `false` | Oletuksena virhe ei koskaan estä PR:ää. |

Ajoraja: kommentti varataan (merkitään ajokerta) ennen mallikutsua. Jos kirjoitus epäonnistuu (esim. `pull-requests: write` puuttuu), työ päättyy ennen mallikutsua eikä maksullista kutsua tehdä.

Katto on tokeneissa, ei dollareissa: tokenit tiedetään ennen kutsua, dollarihinnat eivät. Hinnat annetaan vain arviota varten.

## Turvamalli

- **Ei PR:n koodia.** Action ei tee checkoutia, ei aja mitään eikä kirjoita tiedostoja. Testi tarkistaa, ettei lähdekoodissa ole `child_process`-, `eval`- tai tiedostokirjoituskutsuja eikä kolmannen osapuolen riippuvuuksia.
- **`pull_request`, ei `pull_request_target`.** Jälkimmäisellä salaisuudet olisivat käytössä fork-PR:ille, joiden teksti on epäluotettavaa. Action kieltäytyy käynnistymästä `pull_request_target`-tapahtumalla.
- **Salaisuuksien siivous ennen mallia.** Tunnetut avainmuodot ja `key/token/secret/password`-sijoitukset korvataan, ja `.env`-, avain-, lukko- ja binääritiedostoja ei lähetetä lainkaan. Siivous on regex-pohjainen paras yritys, ei takuu.
- **Epäluotettava teksti.** Diff menee mallille `<data>`-lohkossa, jota ei voi sulkea sisältäpäin, ilman työkaluja. Mallin teksti puhdistetaan: ei linkkejä, HTML:ää, kuvia eikä @-mainintoja.
- **Mallin väitteet tarkistetaan koodilla.** Löydös hyväksytään vain, jos tiedosto oli mukana ja rivi on lisätty rivi, jonka malli näki. Muut pudotetaan ja kommentti kertoo montako.
- **"En tiedä" on hyväksytty vastaus.** Malli saa vastata `unknown`, ja kommentti sanoo silloin suoraan, ettei se ole arvio PR:stä.
- **Rajat ovat koodissa.** Tokenkatot, ajokerrat per PR, vastauksen koko ja aikakatkaisu eivät ole mallin tai PR:n sisällön muutettavissa. Redirectit eivät seuraa (avain ei kulje toiselle palvelimelle), ja kommentin merkin `runs`/`sha` hyväksytään vain bot-tilien kommenteista, joten ihminen ei voi sammuttaa tarkistusta kommentilla.

## Rajoitukset

- Malli voi olla väärässä ja jättää löytämättä asioita. Kommentti sanoo itse "can be wrong". Tarkistus lisäksi tarkastaa vain sijainnin, ei sitä onko väite totta.
- Vain lisätyt rivit ja yksi mallikutsu. Ei repon muuta koodia kontekstina, ei rivikohtaisia kommentteja (yksi yhteenvetokommentti, päivitetään paikallaan), ei keskustelua eikä automaattisia korjauksia.
- Suuri PR katkaistaan tokenkattoon: tiedostot, jotka eivät mahdu, näkyvät kommentin kohdassa "Not reviewed".
- GitHubin ajurit eivät näe yksityisverkon (esim. Tailscale) osoitteita. Käytä julkista https-osoitetta.
- Tekijän testit käyttävät väärennettyä GitHubia ja mallia sekä paikallista HTTP-palvelinta. Oikea mallikokeilu on tehty (katso CHANGELOG): pieni kehote vaikuttaa paljon, ja malli jättää silti osan virheistä löytämättä.

## Vaihtoehtoja ja miksi tämä

Tilanne 17.10.2026. AI-katselmointiin on jo paljon valmiita työkaluja; luin viidestä niiden README:n ja dokumentaation:

- [PR-Agent](https://github.com/qodo-ai/pr-agent) (MIT, yhteisön ylläpitämä, yli 13 000 tähteä): laaja työkalu (`/describe`, `/review`, `/improve`, `/ask`), tukee LiteLLM:ää ja omaa OpenAI-osoitetta. Jos haluat paljon ominaisuuksia, valitse tämä. Luetuilla sivuilla ei näkynyt kulukattoa eikä ohjeita epäluotettavan PR-tekstin varalle, ja `max_output_tokens` on oletuksena rajaton.
- [anc95/ChatGPT-CodeReview](https://github.com/anc95/ChatGPT-CodeReview) (ISC, yli 4 000 tähteä): OpenAI-, Azure- ja GitHub Models -tuki sekä patch-koon rajat. README ei kerro epäluotettavan tekstin käsittelystä.
- [presubmit/ai-reviewer](https://github.com/presubmit/ai-reviewer) (MIT): yhteenveto ja rivikommentit, mutta esimerkki käyttää `pull_request_target`-tapahtumaa ilman turvaperusteluja.
- [Nikita-Filonov/ai-review](https://github.com/Nikita-Filonov/ai-review) (Apache-2.0): monta mallituottajaa ja rivikommentit; agenttitila ajaa komentoja repossa.
- [freeCodeCampin opetusartikkeli](https://www.freecodecamp.org/news/how-to-build-a-secure-ai-pr-reviewer-with-claude-github-actions-and-javascript/) (huhtikuu 2026, ei ylläpidetty työkalu): ainoa, joka kertoo epäluotettavan diffin käsittelystä ja siivoaa salaisuuksia, mutta katkaisee diffin 4 000 merkkiin kertomatta siitä kommentissa.

Tämä ei kilpaile ominaisuuksilla. Se on tarkoituksella pieni ja tekee kolme asiaa, joita luetuissa dokumenteissa ei näkynyt yhdessä: kova ennalta varattu tokenkatto (ja ajokerrat per PR), mallin sallittu "en tiedä" ja löydösten sijainnin tarkistus koodilla, sekä avoin lista siitä mitä ei tarkistettu. Dokumenttien perusteella tehty vertailu on lukemani varassa: jos jokin kohta on vanhentunut tai väärin, avaa issue.

## Kehitys

```bash
npm test      # node --test
```

68 testiä ajetaan ilman verkkoa ja ilman avaimia. Lisäksi 47 tarkoituksella rikottua kohtaa lähdekoodissa (esim. rajan poisto, siivouksen ohitus, redirectin seuranta) kaatuu testeihin; ensimmäisellä kierroksella kuusi selvisi, ja ne paikattiin testeillä.

## Lisenssi

MIT
