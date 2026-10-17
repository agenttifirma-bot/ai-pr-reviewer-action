import { MAX_COMMENT_PAGES, MAX_FILES_LISTED, TIMEOUT_MS } from "./limits.js";

export class GitHubError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function client({ token, apiUrl = "https://api.github.com", fetchImpl = fetch }) {
  const base = new URL(apiUrl);
  if (base.protocol !== "https:" && !(base.hostname === "localhost" || base.hostname === "127.0.0.1")) throw new GitHubError("github_api_must_be_https");
  async function call(path, init = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${apiUrl.replace(/\/+$/, "")}${path}`, {
        redirect: "error",
        signal: ctl.signal,
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "content-type": "application/json",
        },
      });
      if (!res.ok) throw new GitHubError(`github_http_${res.status}`);
      return await res.json();
    } catch (e) {
      if (e instanceof GitHubError) throw e;
      throw new GitHubError(ctl.signal.aborted ? "github_timeout" : "github_network");
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    /** Changed files with their patches. Never downloads or checks out PR code. */
    async listFiles(owner, repo, number) {
      const files = [];
      for (let page = 1; page <= Math.ceil(MAX_FILES_LISTED / 100); page++) {
        const part = await call(`/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
        if (!Array.isArray(part)) throw new GitHubError("github_bad_reply");
        files.push(...part);
        if (part.length < 100) return { files, truncated: false };
      }
      return { files, truncated: true };
    },
    /** Comments written by bot accounts only: a human cannot plant the marker to switch reviews off. */
    async listBotComments(owner, repo, number) {
      const all = [];
      for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
        const part = await call(`/repos/${owner}/${repo}/issues/${number}/comments?per_page=100&page=${page}`);
        if (!Array.isArray(part)) throw new GitHubError("github_bad_reply");
        all.push(...part.filter((c) => c?.user?.type === "Bot"));
        if (part.length < 100) break;
      }
      return all;
    },
    create: (owner, repo, number, body) => call(`/repos/${owner}/${repo}/issues/${number}/comments`, { method: "POST", body: JSON.stringify({ body }) }),
    update: (owner, repo, id, body) => call(`/repos/${owner}/${repo}/issues/comments/${id}`, { method: "PATCH", body: JSON.stringify({ body }) }),
  };
}
