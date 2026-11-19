# Quality metric

Measures whether the reviewer finds known defects and how many false alarms it raises. The numbers are computed from recorded model replies (cassettes), so the same run always gives the same numbers and CI makes no model calls.

17 small hand-written diffs (12 with 13 known defects, 5 clean) are pushed through the real `run()` path with a faked GitHub. Model replies come from cassettes in `eval/cassettes/`. A finding is a hit when the file matches, the line is within 1 and the message contains one of the expected keywords. Reported: defects found (recall), precision, false alarms, clean diffs without findings. Recording a real model needs your own key and is never done in CI.

## Files

| File | Contents |
|---|---|
| `cases.js` | 17 cases: diff, PR title and expected findings (file, line, keywords) |
| `score.js` | hits, misses, false alarms, duplicates and the summary |
| `stub-models.js` | `rule-baseline` (7 regular expressions) and `reference` (returns the expected answers) |
| `run.js` | replay and recording |
| `cassettes/*.json` | recorded replies, one file per model |

All diffs were written for this metric. They contain no private code and no secrets.

## Cases

Defects: SQL query built from strings, loop with `<= length`, unchecked `find()` result, command injection, path traversal, missing `await`, Python mutable default argument, division by zero, bare `except`, assignment in a condition, unchecked HTTP status, and one diff with two defects (`eval` and paging off by one).

Clean: parameterized query, a correct `1..length` loop (a pitfall for rules), a rename, documentation only and a checked division. For a clean diff the answer "unknown" is not an error.

## Scoring

- **Hit:** same file, line at most 1 away, and one of the expected keywords in the message.
- **False alarm:** a finding that hits no expected defect.
- **Duplicate:** a second finding on an already found defect. Neither a hit nor a false alarm.
- **Recall** = hits / expected defects. **Precision** = hits / (hits + false alarms).
- `dropped` is the Action's own count: findings whose line was not a displayed added line.

Keyword matching is crude. A correct finding can be missed if the model describes the defect with words that are not in the list. Check the false alarms by hand before you publish a model's numbers.

## Running

```bash
node eval/run.js               # replays every cassette, no network, no cost
node eval/run.js --strict      # exit code 1 if any cassette is stale or incomplete
node eval/run.js --json        # summary as machine-readable JSON
npm test                       # the tests also check that the README numbers match the cassette
```

Stub cassettes are regenerated like this (for example after a prompt change):

```bash
node eval/run.js --record --stub rule-baseline
node eval/run.js --record --stub reference
```

## Recording a real model (locally, your own key)

```bash
LLM_API_KEY=... node eval/run.js --record --base-url https://api.example.com/v1 --model MODEL-NAME
node eval/run.js --cassette eval/cassettes/MODEL-NAME.json
```

- One call per case (17), hard ceiling `MAX_CALLS` = 40. The call is the same as in the Action: `temperature` 0 and `max_tokens` 1500 by default.
- The key is read only from the environment. It is not printed and not stored in the cassette (tested).
- `--base-url` accepts only an https address or localhost, like the Action.
- The cassette stores the raw model reply, the usage numbers and the SHA-256 hash of the request. Read the cassette before you commit it.

## Stale cassettes

A cassette stores a hash of the system prompt and the user message. If the prompt, the diff or the title changes, the hash no longer matches and the case is marked stale. A stale case is not scored, because the reply belongs to a different request. A test requires every committed cassette to be up to date.

## Limitations

- 17 cases are a small sample. One case changes recall by about 8 percentage points.
- The diffs are small and the defect is obvious. Real PRs have more context and fewer obvious defects.
- The stub models' numbers say nothing about the quality of a language model.
