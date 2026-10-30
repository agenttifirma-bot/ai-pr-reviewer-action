// Hard limits. Code is law: none of these can be overridden by the model or by PR content.
export const MAX_FILES_LISTED = 300;        // GitHub API: 3 pages x 100
export const MAX_COMMENT_PAGES = 5;
export const MAX_FINDINGS = 10;
export const MAX_SUMMARY_CHARS = 400;
export const MAX_MESSAGE_CHARS = 300;
export const MAX_REASON_CHARS = 200;
export const MAX_RESPONSE_BYTES = 200_000;
export const TIMEOUT_MS = 60_000;
export const CHARS_PER_TOKEN = 3;           // conservative: real code is ~3.5-4 chars/token
export const FRAMING_CHARS = 400;          // user-message framing: title line, <data> tags, separators (title is cut at 200)
export const DEFAULTS = {
  maxInputTokens: 20_000,
  maxOutputTokens: 1_500,
  maxRunsPerPr: 5,
};
export const HARD_CAPS = { maxInputTokens: 100_000, maxOutputTokens: 4_000, maxRunsPerPr: 20 };
export const SEVERITIES = ["high", "medium", "low"];
export const CONFIDENCES = ["high", "medium"];
