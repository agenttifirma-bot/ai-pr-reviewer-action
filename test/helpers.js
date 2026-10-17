import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SHA = "a".repeat(40);
export const SHA2 = "b".repeat(40);
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
export { json };

export const PATCH = "@@ -1,3 +1,5 @@\n const a = 1;\n+const b = readConfig();\n+use(b.value);\n const c = 3;\n-old();";

export function eventFile({ number = 7, sha = SHA, title = "Fix things", fork = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aipr-"));
  const p = path.join(dir, "event.json");
  fs.writeFileSync(p, JSON.stringify({ pull_request: { number, title, head: { sha, repo: { fork } } } }));
  return p;
}

export function baseEnv(over = {}) {
  return {
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_REPOSITORY: "octo/demo",
    GITHUB_EVENT_PATH: eventFile(),
    "INPUT_API-KEY": "test-key-not-real",
    "INPUT_BASE-URL": "https://llm.example/v1",
    INPUT_MODEL: "test-model",
    "INPUT_GITHUB-TOKEN": "gh-test-token",
    ...over,
  };
}

/** Fake network: GitHub REST + one LLM endpoint. Records every call. */
export function fakeNet({ files = [{ filename: "src/app.js", status: "modified", patch: PATCH }], comments = [], reply, llmStatus = 200, llmThrow = false } = {}) {
  const calls = [];
  const state = { comments: [...comments], nextId: 1000 };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: u, method: init.method ?? "GET", body, headers: init.headers });
    if (u.startsWith("https://llm.example/v1/chat/completions")) {
      if (llmThrow) throw new Error("boom");
      const content = typeof reply === "function" ? reply(body) : reply;
      return json({ choices: [{ message: { content } }], usage: { prompt_tokens: 1200, completion_tokens: 80 } }, llmStatus);
    }
    if (/\/pulls\/\d+\/files/.test(u)) return json(files);
    if (/\/issues\/\d+\/comments/.test(u) && (init.method ?? "GET") === "GET") return json(state.comments);
    if (/\/issues\/\d+\/comments/.test(u) && init.method === "POST") {
      const c = { id: state.nextId++, body: body.body, user: { type: "Bot" } };
      state.comments.push(c);
      return json(c, 201);
    }
    if (/\/issues\/comments\/\d+/.test(u) && init.method === "PATCH") {
      const id = Number(u.split("/").pop());
      const c = state.comments.find((x) => x.id === id);
      c.body = body.body;
      return json(c);
    }
    return json({ message: "not found" }, 404);
  };
  return { fetchImpl, calls, state, llmCalls: () => calls.filter((c) => c.url.includes("/chat/completions")) };
}

export const okReply = (findings = [{ file: "src/app.js", line: 2, severity: "medium", confidence: "high", message: "readConfig() may return undefined; b.value would throw." }]) =>
  JSON.stringify({ result: "ok", summary: "One possible null access.", findings });

export const silent = { log() {} };
