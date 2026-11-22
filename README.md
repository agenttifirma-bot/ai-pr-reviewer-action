**Language:** English | [Suomi](README.fi.md)

# ai-pr-reviewer-action

[![CI](https://github.com/tonyweckstrom1987/ai-pr-reviewer-action/actions/workflows/ci.yml/badge.svg)](https://github.com/tonyweckstrom1987/ai-pr-reviewer-action/actions/workflows/ci.yml) ![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

A GitHub Action that posts one AI review comment per pull request with a hard token ceiling, an explicit "I do not know" answer, and no access to PR code or secrets. It works with any OpenAI-compatible endpoint (OpenRouter, LiteLLM, OpenAI and others).

**In short:** it never checks out or runs PR code, sends only redacted diff text to any OpenAI-compatible endpoint, refuses `pull_request_target`, does nothing on fork PRs (no key), and only accepts findings that point at added lines the model was actually shown. Zero runtime dependencies, Node 24 runtime.

**Technologies:** JavaScript (ESM), Node.js 22/24, `node:test`. No runtime dependencies.

## Quick start

Copy [`examples/review.yml`](examples/review.yml) into `.github/workflows/` in your repository and add the secret `LLM_API_KEY` (the model key):

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
      - uses: tonyweckstrom1987/ai-pr-reviewer-action@v0.1.2
        with:
          api-key: ${{ secrets.LLM_API_KEY }}
          base-url: https://openrouter.ai/api/v1
          model: deepseek/deepseek-chat
```

The Action does not run a `checkout` step and does not need one: it reads the changed files through the GitHub API and posts **one** comment, updated in place.

Setup step by step:

1. Copy `examples/review.yml` to `.github/workflows/ai-review.yml`.
2. Add the repository secret `LLM_API_KEY`. Change `base-url` and `model` if needed; `base-url` must be an `https` address.
3. If you like, try it first by adding `dry-run: "true"` to the `with` block: the comment is printed to the job log and not posted to the PR. Remove the line when the result looks good.
4. Open a pull request. The Action posts one comment and updates it in place when more commits are pushed to the PR (at most `max-runs-per-pr` times). If the same commit has already been reviewed, it is skipped.

The example file also prevents overlapping runs (`concurrency`), skips draft PRs, and times the job out after 5 minutes.

Security policy and threat model: see [`SECURITY.md`](SECURITY.md).

## Permissions

The workflow that uses the Action needs exactly these permissions:

| Permission | Why |
| --- | --- |
| `contents: read` | Read the pull request's changed files through the GitHub API. Nothing is checked out. |
| `pull-requests: write` | Write one review comment and update it in place. |

Do not grant more (for example `write-all`). Use the `pull_request` event: the Action refuses to run on `pull_request_target`.

## Versioning and pinning

Releases follow semantic versioning and are tagged `vX.Y.Z` (see [`CHANGELOG.md`](CHANGELOG.md)). Before 1.0.0, a minor version may change inputs. The examples use the exact release tag (`@v0.1.2`).

A tag can be moved. If your threat model needs it, pin the full 40-character commit SHA of a release instead and keep the version in a comment, so Dependabot can still update it:

```yaml
- uses: tonyweckstrom1987/ai-pr-reviewer-action@<full-commit-sha> # v0.1.2
  with:
    api-key: ${{ secrets.LLM_API_KEY }}
    base-url: https://openrouter.ai/api/v1
    model: deepseek/deepseek-chat
```

From 1.0.0 on, a moving major tag (`v1`) will point at the latest `v1.x.y` release. Breaking changes, such as removed or renamed inputs, will get a new major version. The release steps are in [`RELEASING.md`](RELEASING.md).

## Quality

[`eval/`](eval/README.md) measures whether the reviewer finds known defects and how many false alarms it raises: 17 small hand-written diffs (12 with 13 known defects, 5 clean), scored mechanically (same file, line within 1, a keyword in the message). Model replies are stored as cassettes in `eval/cassettes/`, so CI replays them through the real `run()` path without network calls or keys.

**No language model has been measured yet.** The only cassettes so far come from two stub models (code, not models). They show that the metric works and give a floor a model should beat:

| Cassette | Defects found | False alarms | Clean diffs without findings |
|---|---|---|---|
| stub-rule-baseline (7 regular expressions, baseline) | 7/13 | 1 | 4/5 |
| stub-reference (returns the expected answers, sanity check) | 13/13 | 0 | 5/5 |

Reproduce: `node eval/run.js`. Recording a real model needs your own key (see [`eval/README.md`](eval/README.md)).

## Prompt injection test suite

See [`injektio/README.md`](injektio/README.md) (written in Finnish): 19 cases (OWASP LLM01/LLM06), a canary metric, and a runner that records results in `kokeilut.jsonl` format.

Offline result with a stub model that obeys everything: the code limits held in 3 of 19 cases (one is the control); 16 were obeyed (stub models only, no real model): [`injektio/RESULTS.md`](injektio/RESULTS.md).

## Settings

| Input | Default | Meaning |
| --- | --- | --- |
| `api-key` | (empty) | Model key. On fork PRs GitHub does not provide secrets, so the Action then does nothing. |
| `base-url` | (required) | OpenAI-compatible endpoint, `https` only. |
| `model` | (required) | Model name. |
| `github-token` | `${{ github.token }}` | Token for reading the PR files and writing one comment. The default is enough; override only if you need a different token. |
| `max-input-tokens` | 20 000 | Ceiling for the estimated input (max 100 000). The estimate is 3 characters per token, which holds for code and English but under-counts non-ASCII text (e.g. CJK, emoji), where the real count can be higher. The real length of the system prompt is included. As many files as fit, smallest first; the rest are listed in the comment as "Not reviewed". |
| `max-output-tokens` | 1 500 | Hard ceiling for the reply (max 4 000). |
| `max-runs-per-pr` | 5 | How many times one PR is reviewed across all pushes (max 20). |
| `price-in`, `price-out` | 0 | USD per million tokens. Used only for the cost estimate on the last line of the comment. |
| `dry-run` | `false` | `true` prints the comment to the log instead of posting it. |
| `fail-on-error` | `false` | By default an error never blocks the PR. |

Run limit: the comment is reserved (the run is counted) before the model call. If the write fails (e.g. `pull-requests: write` is missing), the job ends before the model call and no paid request is made.

The ceiling is in tokens, not dollars: tokens are known before the call, dollar prices are not. Prices are given only for the estimate.

## Security model

- **No PR code.** The Action does no checkout, runs nothing and writes no files. A test checks that the source contains no `child_process`, `eval` or file-writing calls and no third-party dependencies.
- **`pull_request`, not `pull_request_target`.** With the latter, secrets would be available to fork PRs, whose text is untrusted. The Action refuses to start on the `pull_request_target` event.
- **Secret redaction before the model.** Known key formats, `Bearer` tokens (any letter case: `Bearer`, `bearer`, `BEARER`) and `key/token/secret/password` assignments are replaced, and `.env`, key, lock and binary files are not sent at all. Assignments are matched in two linear steps, so long key-like words cannot make the redaction slow. Redaction is a regex-based best effort, not a guarantee. A value ends at `;`, and the part after `;` is not hidden (see Limitations).
- **Untrusted text.** The diff goes to the model in a `<data>` block that cannot be closed from the inside, without tools. The model's text is sanitized: no links, HTML, images or @-mentions.
- **The model's claims are checked by code.** A finding is accepted only if the file was included and the line is an added line the model saw. Others are dropped and the comment says how many.
- **"I do not know" is an accepted answer.** The model may answer `unknown`, and the comment then says plainly that it is not an assessment of the PR.
- **Policy and threat model.** [`SECURITY.md`](SECURITY.md) lists each protection with its source location, the known limitations, and how to report a vulnerability privately.
- **Limits live in code.** Token ceilings, runs per PR, response size and timeout cannot be changed by the model or by PR content. Redirects are not followed (the key never travels to another server), and the `runs`/`sha` marker in a comment is accepted only from comments by the action's own bot account (`github-actions[bot]`, the author of comments made with the default `GITHUB_TOKEN`), so neither a human nor another app can switch the review off with a comment.

## Limitations

- Redaction misses unknown secret formats. One known gap: in an assignment such as `token=abc123;def456` only the part before `;` is hidden. An edge test records this as a known gap (`todo`). Details and other limits of the design: [`SECURITY.md`](SECURITY.md).
- The model can be wrong and can miss things. The comment itself says "can be wrong". The check also verifies only the location, not whether the claim is true.
- Added lines only, and one model call. No other repository code as context, no line-by-line comments (one summary comment, updated in place), no conversation and no automatic fixes.
- A large PR is cut at the token ceiling: files that do not fit appear in the "Not reviewed" section of the comment. At most 300 files are read from the file list; the rest are marked as not reviewed.
- The comment shows at most 10 findings, and the model call times out after 60 seconds. If the call fails, no comment is posted and the PR is not blocked (unless `fail-on-error` is `true`).
- Without `api-key` (fork PR), nothing is sent anywhere.
- GitHub-hosted runners cannot reach private-network addresses (e.g. Tailscale). Use a public https address.
- The author's tests use a fake GitHub, a fake model and a local HTTP server. A real model trial has been done (see CHANGELOG): a small prompt has a large effect, and the model still misses some defects.

## Alternatives and why this one

Situation on 17 October 2026. Many ready-made AI review tools already exist; I read the README and documentation of five of them:

- [PR-Agent](https://github.com/The-PR-Agent/pr-agent) (MIT, community-maintained, over 13,000 stars): a broad tool (`/describe`, `/review`, `/improve`, `/ask`) that supports LiteLLM and your own OpenAI address. If you want many features, choose this. The pages I read showed no cost ceiling and no guidance for untrusted PR text, and `max_output_tokens` is unlimited by default.
- [anc95/ChatGPT-CodeReview](https://github.com/anc95/ChatGPT-CodeReview) (ISC, over 4,000 stars): OpenAI, Azure and GitHub Models support and patch size limits. The README does not say how untrusted text is handled.
- [presubmit/ai-reviewer](https://github.com/presubmit/ai-reviewer) (MIT): summary and line comments, but the example uses the `pull_request_target` event without any security reasoning.
- [Nikita-Filonov/ai-review](https://github.com/Nikita-Filonov/ai-review) (Apache-2.0): many model providers and line comments; the agent mode runs commands in the repository.
- [freeCodeCamp tutorial article](https://www.freecodecamp.org/news/how-to-build-a-secure-ai-pr-reviewer-with-claude-github-actions-and-javascript/) (April 2026, not a maintained tool): the only one that discusses handling an untrusted diff and redacts secrets, but it truncates the diff to 4,000 characters without saying so in the comment.

This does not compete on features. It is deliberately small and does three things that I did not see together in the documents I read: a hard, pre-reserved token ceiling (and runs per PR), an allowed "I do not know" answer with a code check of finding locations, and an open list of what was not reviewed. The comparison is based on the documents as I read them: if something is out of date or wrong, open an issue.

## Development

Requires Node.js 22 or newer (`engines` in `package.json`); CI runs the tests on Node 22 and 24. There is nothing to install, because there are no dependencies.

```bash
npm test      # node --test "test/*.test.js"
```

The suite has 215 tests: 214 pass and 1 is marked `todo` (a known gap, see above), with no failures. They run without a network and without keys. The source has also been broken on purpose (e.g. removing a limit, bypassing redaction, following a redirect) to check that the tests catch it.

## License

MIT
