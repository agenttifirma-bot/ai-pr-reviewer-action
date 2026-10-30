import { CHARS_PER_TOKEN, FRAMING_CHARS } from "./limits.js";
import { SYSTEM_PROMPT } from "./prompt.js";

export function estimateTokens(chars) {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** Fixed input overhead in tokens: the real system prompt length plus the user-message framing. */
export function overheadTokens(systemPrompt = SYSTEM_PROMPT) {
  return estimateTokens(systemPrompt.length + FRAMING_CHARS);
}

/**
 * Reserve before calling: choose files so that the estimated input stays within maxInputTokens.
 * Smallest patches first (most files reviewed per token). Everything left out is reported, never silently dropped.
 * @param {{filename: string, text: string}[]} files
 * @returns {{kept: typeof files, skipped: {filename: string, reason: string}[], inputTokens: number}}
 */
export function select(files, maxInputTokens, overhead = overheadTokens()) {
  let used = overhead;
  const kept = [];
  const skipped = [];
  const order = [...files].sort((a, b) => a.text.length - b.text.length || a.filename.localeCompare(b.filename));
  for (const f of order) {
    const cost = estimateTokens(f.text.length + f.filename.length + 40);
    if (used + cost <= maxInputTokens) {
      kept.push(f);
      used += cost;
    } else {
      skipped.push({ filename: f.filename, reason: "over the input token budget" });
    }
  }
  kept.sort((a, b) => a.filename.localeCompare(b.filename));
  return { kept, skipped, inputTokens: used };
}

/** Estimated cost in USD from per-million-token prices; null when prices are not configured. */
export function cost(inputTokens, outputTokens, priceIn, priceOut) {
  if (!(priceIn > 0) && !(priceOut > 0)) return null;
  return ((inputTokens * (priceIn || 0)) + (outputTokens * (priceOut || 0))) / 1_000_000;
}
