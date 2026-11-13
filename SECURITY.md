# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability** (private vulnerability reporting). Do not open a public issue or pull request for a suspected vulnerability.

Include the Action version (tag), the workflow file you use (with secrets removed) and the smallest input that shows the problem. Never include real API keys or tokens in a report.

This is a one-person hobby project. I read reports as soon as I can but cannot promise a response time.

## Supported versions

| Version | Supported |
|---|---|
| Latest `v0.1.x` tag | yes |
| Older tags | no: upgrade to the latest tag |

Tags are movable references. If you want an immutable reference, pin the Action to a full commit SHA in your workflow.

## What the Action does

On a `pull_request` event it reads the changed files' patches through the GitHub API, removes secret-looking strings, sends the patches in one request to the OpenAI-compatible endpoint you configure, validates the reply in code and writes one comment on the pull request. It does not check out or run PR code (`src/github.js` only calls the REST API).

## Permissions the token needs

The example workflow (`examples/review.yml`) asks for exactly:

- `contents: read`: the job needs no more because nothing is checked out.
- `pull-requests: write`: to create and update one comment.

Nothing else is requested. The Action's own `github-token` input defaults to the job's `github.token` (`action.yml`).

## Threat model

Everything in a pull request (diff, title, file names) is untrusted text written by the PR author. The model's reply is untrusted too. The table lists each threat, the protection and where it lives in the code. Paths are relative to the repository root and line numbers refer to the state of `master` when this document was written.

| Threat | Protection | Where |
|---|---|---|
| Workflow uses `pull_request_target`, so fork PRs would run with secrets | The Action refuses any event other than `pull_request` and stops with an error | `src/index.js:35-39`, test `test/index.test.js:49` |
| Fork PR or Dependabot PR: no secrets are passed by GitHub | With an empty `api-key` the Action ends before any network call; nothing is sent anywhere | `src/index.js:52-56` |
| PR code is executed or checked out on the runner | The source uses no child processes, `eval`, file writes or dependencies; the example workflow has no checkout step | `test/repo.test.js:23`, `examples/review.yml` |
| Over-privileged token | Example asks for `contents: read` and `pull-requests: write` only | `examples/review.yml` |
| Secrets in the diff reach the model provider | Known key formats and `key/token/secret/password` assignments are replaced before sending; `.env`, key, credential and lock files and binaries are never sent | `src/redact.js:3-14`, `src/diff.js:29`, `src/index.js:84,103` |
| Prompt injection: PR text tells the model what to do | The system prompt marks `<data>` as untrusted; the model has no tools and gets one request only | `src/prompt.js:3-4`, `src/llm.js:35-40` |
| Injection closes the `<data>` block (also with zero-width characters, Unicode tag characters, wide or look-alike brackets) | Text is normalised (invisible characters removed, NFKC, bracket look-alikes folded) and any `<data>` or `</data>` tag is replaced; applies to the title and file names too | `src/prompt.js:15-38`, `test/injektio.test.js:103` |
| Model output carries links, images, HTML or @-mentions into the comment | Model text is stripped of control and bidi characters, links, images, HTML and backticks, and `@` is broken; length is capped | `src/validate.js:11-20` |
| Model invents files or lines | A finding is kept only if its file was sent and its line is an added line the model saw; others are dropped and counted | `src/validate.js:49-54`, `src/diff.js:4` |
| Model reply is huge, slow or not JSON | Response size limit, 60 s timeout, strict JSON checking; on failure no comment is posted | `src/llm.js:27,44`, `src/validate.js`, `src/limits.js` |
| Cost runaway | Input and output token ceilings with hard upper caps; at most N reviews per PR (hard cap 20), counted before the paid call; the same commit is never reviewed twice | `src/limits.js:12-17`, `src/budget.js`, `src/index.js:60-62,70-78,109-120` |
| API key or token sent to another host | HTTPS only (plain HTTP only for localhost); no credentials in the URL; redirects are refused for both the model and GitHub calls | `src/llm.js:10-21,32`, `src/github.js:12,18` |
| A human switches the review off by planting the run marker in a comment | Only comments from bot accounts are read for the marker | `src/github.js:55`, `test/github.test.js:18` |
| Secrets or PR text in logs | Errors are logged as a short code only (no message, no response body); the key is used only in the request header. `dry-run` prints the comment, which contains no raw diff | `src/index.js:141-154`, `src/llm.js:34` |

## Known limitations

These are real gaps or limits. They are listed so that you can decide whether the Action fits your risk level.

1. **Redaction is best effort.** It is regex based and misses formats it does not know (`src/redact.js`). Anything else in the diff is sent to the model provider you configured. Do not use the Action on repositories whose diffs must not leave your control.
2. **Prompt injection cannot be solved in code.** The checks above limit what an injected instruction can do (no tools, sanitised output, verified locations), but a persuaded model can still produce a misleading review: for example hide a real defect, or write a wrong finding on a real added line. Treat the comment as a hint, not a verdict. The comment itself says "can be wrong".
3. **File names are not neutralised in the comment.** `src/render.js:12,29,37` only replaces backticks in file names. A file name that contains a newline would end the code span, so the text after it is rendered as ordinary Markdown (links, @-mentions) in the bot's comment. This was shown by calling `render()` directly; it has not been tested on real GitHub, which may refuse or escape such names. Model text is cleaned (`src/validate.js:11`), file names are not.
4. **Any bot can set the run marker.** The marker is read from comments by any account of type `Bot`, not only from the Action's own account (`src/github.js:55`). A third-party bot that wrote the marker format into a comment could make the Action skip a commit or reach its run limit. A human cannot do this.
5. **A failed model call uses one run.** The run is counted before the call (by design, to stop cost runaway), so repeated failures can reach `max-runs-per-pr` without any review.
6. **Third-party model, your choice.** The Action does not check the host in `base-url`. The workflow author chooses it; PR authors cannot.
7. **Mutable version tags.** `@v0.1.2` is a tag. Pin a commit SHA if you need an immutable reference.
8. **Tested against fakes plus one real trial.** Tests use a fake GitHub and a fake model; the prompt-injection suite in `injektio/` measures a model only when run against a real endpoint (see `injektio/README.md`). No third-party security audit has been done.
