import { CHARS_PER_TOKEN, PROMPT_OVERHEAD_TOKENS } from "./limits.js";

export function estimateTokens(chars) {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Reserve before calling: choose files so that the estimated input stays within maxInputTokens.
 * Smallest patches first (most files reviewed per token). Everything left out is reported, never silently dropped.
 * @param {{filename: string, text: string}[]} files
 * @returns {{kept: typeof files, skipped: {filename: string, reason: string}[], inputTokens: number}}
 */
export function select(files, maxInputTokens) {
  let used = PROMPT_OVERHEAD_TOKENS;
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
