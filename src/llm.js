import { MAX_RESPONSE_BYTES, TIMEOUT_MS } from "./limits.js";

export class LLMError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function checkBaseUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new LLMError("llm_bad_base_url");
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new LLMError("llm_base_url_must_be_https");
  if (u.username || u.password) throw new LLMError("llm_bad_base_url");
  return url.replace(/\/+$/, "");
}

/** One OpenAI-compatible chat completion call, no tools, no streaming, no redirects, capped size and time. */
export async function chat({ baseUrl, apiKey, model, system, user, maxOutputTokens, timeoutMs = TIMEOUT_MS, fetchImpl = fetch }) {
  const base = checkBaseUrl(baseUrl);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      redirect: "error",
      signal: ctl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: maxOutputTokens,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new LLMError(`llm_http_${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_RESPONSE_BYTES) throw new LLMError("llm_response_too_large");
    let data;
    try {
      data = JSON.parse(buf.toString("utf8"));
    } catch {
      throw new LLMError("llm_bad_json");
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content === "") throw new LLMError("llm_empty_reply");
    const u = data.usage ?? {};
    const input = Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : null;
    const output = Number.isFinite(u.completion_tokens) ? u.completion_tokens : null;
    return { content, usage: input != null && output != null ? { input, output } : null };
  } catch (e) {
    if (e instanceof LLMError) throw e;
    throw new LLMError(ctl.signal.aborted ? "llm_timeout" : "llm_network");
  } finally {
    clearTimeout(timer);
  }
}
