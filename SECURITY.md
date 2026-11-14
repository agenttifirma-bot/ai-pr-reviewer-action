# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability** (private vulnerability reporting). Do not open a public issue or pull request for a suspected vulnerability.

Include the Action version, the workflow file you use (without secrets), and the smallest pull request content that reproduces the problem. Never include real API keys or tokens in a report.

This is a one-person project. There is no response-time guarantee, but reports are read and answered on a best-effort basis.

## Supported versions

Only the latest released version receives fixes. At the time of writing this is `v0.1.2` (see `package.json` and `CHANGELOG.md`). Older `0.1.x` tags are not patched; upgrade instead.

## What the Action does with your data

On a `pull_request` event it reads the changed files' diffs (`src/github.js:39`), removes secret-like strings (`src/redact.js`), sends the result in one request to the `base-url` you configure (`src/llm.js:24`), and writes one comment to the pull request (`src/index.js:109-139`). It does not check out, build or run pull request code. It has no runtime dependencies: every import is a Node built-in or a local file (checked by `test/repo.test.js:26-27`).

The diff text, the PR title and the file names leave the runner and go to the model provider you chose. Pick a provider whose data handling you accept.

## Threat model

All line references are to the repository at the commit this document was written against.

| Threat | Protection | Where |
| --- | --- | --- |
| Fork PR gets access to secrets (the classic `pull_request_target` mistake) | The Action throws and stops on `pull_request_target` and on any event other than `pull_request`. The example workflow uses `pull_request`. On fork PRs GitHub supplies no secrets, and an empty `api-key` makes the Action do nothing | `src/index.js:35-39`, `src/index.js:52-56`, `examples/review.yml:4` |
| Pull request code runs on the runner | The Action never checks out the repository and never runs PR code. It only calls the GitHub REST API for the file list. The example workflow does not use `actions/checkout` | `src/github.js:38-48`, `examples/review.yml:16-31`, `test/repo.test.js:26` |
| Token has more rights than needed | The example grants only `contents: read` and `pull-requests: write`. The default `github.token` is used | `examples/review.yml:7-9`, `action.yml:17-20` |
| Prompt injection: PR text tells the model to follow new instructions or to close the data block | The diff, title and file names are placed in a `<data>` block. Invisible characters are removed, text is NFKC-normalized, look-alike angle brackets are folded, and any `<data>` or `</data>` tag inside the text is replaced. The system prompt says the content is untrusted. The model has no tools | `src/prompt.js:3-4`, `src/prompt.js:15-37`, `src/llm.js:35-40` |
| A successful injection makes the model write links, images, HTML or @-mentions into the comment | The model's text is cleaned: control and bidi characters, Markdown links and images, HTML tags and URLs are removed, backticks are replaced, and `@` is broken with a zero-width space. Lengths are capped | `src/validate.js:11-20`, `src/limits.js:5-7`, `src/render.js:12` |
| The model points at code it was not shown, or invents files | A finding is kept only if the file was sent, the line is an added line that was shown, and severity and confidence are valid. Others are dropped and counted in the comment. At most 10 findings are kept | `src/validate.js:40-76`, `src/diff.js:4-27`, `src/limits.js:4` |
| The model's reply is huge, malformed or not JSON | The reply must be at most 200 000 bytes, JSON, and have `result` of `ok` or `unknown`. Otherwise the run ends with an error code and no comment is posted | `src/llm.js:43-52`, `src/validate.js:23-42` |
| Secrets in the diff are sent to the model provider | Known key formats and `key`, `token`, `secret`, `password` assignments are replaced before sending. Files such as `.env`, keys, certificates, lock files and binaries are never sent | `src/redact.js:3-31`, `src/diff.js:29-38`, `src/index.js:100-108` |
| The API key is sent to another server through a redirect or a plain `http` URL | `base-url` must be `https` (plain `http` only for `localhost` and `127.0.0.1`) and must not contain credentials. Redirects are not followed for the model call or the GitHub calls | `src/llm.js:10-21`, `src/llm.js:32`, `src/github.js:12`, `src/github.js:18` |
| Cost runaway: huge PRs, many pushes, many runs | The estimated input is limited by `max-input-tokens` (hard cap 100 000), the output by `max-output-tokens` (hard cap 4 000), and runs by `max-runs-per-pr` (hard cap 20). The run is counted in a comment before the paid call. If that write fails, no model call is made. The same commit is not reviewed twice. The example adds `concurrency` with `cancel-in-progress` and a 5-minute timeout | `src/limits.js:12-17`, `src/index.js:60-62`, `src/index.js:70-77`, `src/index.js:109-119`, `src/budget.js:19-35`, `examples/review.yml:11-18` |
| A human plants the hidden run marker in a comment to switch reviews off | Only comments from accounts of type `Bot` are read for the marker | `src/github.js:49-58` |
| Secrets or PR text end up in the job log | Errors are reported as a short code only (for example `llm_http_403`), never the exception message or response body. Only `dry-run: "true"` prints the comment to the log, and that comment contains the cleaned model output, not the raw diff | `src/index.js:141-157`, `src/llm.js:42`, `src/github.js:28` |
| Hung requests | Every request is aborted after 60 seconds | `src/limits.js:9`, `src/llm.js:26-27`, `src/github.js:14-15` |

Prompt-injection cases (direct, hidden, role-play, urgency, excessive agency, leak requests) and an offline runner are in `injektio/` (documentation in Finnish: `injektio/README.md`).

## Known limitations

These are things the Action does **not** protect against. They are listed so that you can decide whether the Action fits your repository.

- **The model can still be steered.** The `<data>` block and the system prompt reduce the risk but do not guarantee that a model ignores injected text. The hard limits are in code (see the table), so a steered model cannot call tools, post links, or touch other pull requests. It can still produce a wrong review, for example a false "no issues found". Treat the comment as advice, never as an approval.
- **A finding is checked for location only.** The code verifies that the line was shown and was added. It does not verify that the claim is true.
- **Redaction is best effort.** It is regex based and misses unknown formats and secrets without a recognizable name or shape. The file-name filter does not cover every secret file name.
- **The PR title and file names are not redacted.** They are normalized and defanged (`src/prompt.js:32-37`), but `redact()` runs only on the diff text (`src/index.js:103`). A secret placed in a title or a path would be sent to the provider.
- **Diffs leave your infrastructure.** All reviewed diff text goes to the `base-url` endpoint. The Action cannot control how the provider stores or uses it.
- **Anyone who can change the workflow can read the key.** For a pull request from the same repository, the workflow file in the PR branch is the one that runs, with secrets available. A collaborator with write access can edit it to print or send `LLM_API_KEY`. Limit who can push branches, and use an API key with a spending limit.
- **The Action is referenced by tag.** The example uses `@v0.1.2`. A tag can be moved. If your threat model needs it, pin the Action to a full commit SHA.
- **The run marker is trusted from any bot account.** `listBotComments` accepts comments of type `Bot`, not only your own bot or `github-actions[bot]`. Another app installed in the repository that can comment could plant or change the marker (`src/github.js:55`, `src/render.js:1`).
- **Run counting is not atomic.** The run counter is read, then written. Two overlapping runs could both pass the limit by one. The example's `concurrency` setting reduces this.
- **Dependabot and some bot-created pull requests have no secrets.** GitHub gives them a separate secret store, so the Action skips them. That is safe but may look like a failure.
- **The token permission is checked by writing.** There is no separate check of the granted permissions. A missing `pull-requests: write` is detected when the reservation comment fails (`src/index.js:109-119`).
- **Not independently audited.** The tests use a fake GitHub, a fake model and a local HTTP server. A real model has been tried only on a small scale (see `CHANGELOG.md`).
