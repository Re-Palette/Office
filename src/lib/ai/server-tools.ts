import "server-only";

import { runExecute, runSearch } from "./index";
import type { ToolDef } from "./types";

/**
 * The adapter for tools the model does not run itself.
 *
 * Claude hosts `web_search`, `web_fetch` and `code_execution` on its own
 * servers: the model calls one mid-turn and the result comes back inside the
 * same turn, alongside ordinary tool definitions. Gemini has equivalents
 * (`googleSearch`, `urlContext`, `codeExecution`) but they are tool *types*
 * that cannot be sent in the same request as `functionDeclarations` — so
 * taking them literally would mean choosing between web search and the
 * company's eleven tools.
 *
 * So they are declared to the model as ordinary functions and executed here
 * instead. Searching and running code are asked of the provider, which does
 * each as its own nested single-purpose call — the shape every one of them
 * requires, by its own mechanism. Fetching a page does not need a model at
 * all, so it is done directly here, which also makes it cost no quota.
 *
 * Two things fall out of owning the execution, both of which the free tier
 * wants: every result is capped before it enters the transcript, and a fetch
 * costs nothing.
 */

/** Ceilings on what one tool result may add to the conversation. */
const SEARCH_RESULT_CHARS = 6_000;
const FETCH_RESULT_CHARS = 12_000;
const CODE_RESULT_CHARS = 4_000;
/** A page larger than this is not worth reading into a prompt. */
const FETCH_MAX_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 20_000;

/* ── Declarations handed to the model ─────────────────────────────────────── */

export const WEB_SEARCH_TOOL: ToolDef = {
  name: "web_search",
  description:
    "Search the web for current, external facts and get an answer with its sources. Use this when the answer is not in the company's own data — never guess at an outside fact. One call per question; make the query specific.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "検索したいこと（具体的に）" },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export const WEB_FETCH_TOOL: ToolDef = {
  name: "web_fetch",
  description:
    "Read the text of a specific web page by URL. Use this after web_search when you need the detail of one source, or when the CEO gives you a link.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "読み取るページのURL（http/https）" },
    },
    required: ["url"],
    additionalProperties: false,
  },
};

export const CODE_EXECUTION_TOOL: ToolDef = {
  name: "code_execution",
  description:
    "Run Python to compute something exactly — arithmetic over company figures, statistics, date maths. Describe the calculation and the input values; the code is written and run for you and you get the output back. Use this instead of doing arithmetic in your head.",
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "計算してほしい内容と、使う数値をすべて含めた説明（日本語でよい）",
      },
    },
    required: ["task"],
    additionalProperties: false,
  },
};

export const SERVER_TOOL_NAMES = new Set([
  WEB_SEARCH_TOOL.name,
  WEB_FETCH_TOOL.name,
  CODE_EXECUTION_TOOL.name,
]);

/* ── web_search ───────────────────────────────────────────────────────────── */

export async function runWebSearch(
  query: string,
): Promise<{ content: string; isError: boolean }> {
  if (!query.trim()) return { content: "検索語が空です。", isError: true };

  const { text, sources, error } = await runSearch(query);

  if (error) return { content: `検索に失敗しました: ${error}`, isError: true };
  if (!text && sources.length === 0) {
    return { content: "検索結果が得られませんでした。語を変えて試してください。", isError: false };
  }

  const cited = sources
    .slice(0, 8)
    .map((s, i) => `[${i + 1}] ${s.title ?? "(無題)"} — ${s.uri ?? ""}`)
    .join("\n");

  return {
    content: cap(
      `${text}${cited ? `\n\n出典:\n${cited}` : ""}`,
      SEARCH_RESULT_CHARS,
    ),
    isError: false,
  };
}

/* ── code_execution ───────────────────────────────────────────────────────── */

export async function runCodeExecution(
  task: string,
): Promise<{ content: string; isError: boolean }> {
  if (!task.trim()) return { content: "計算内容が空です。", isError: true };

  const { text, error } = await runExecute(task);

  if (error) return { content: `計算に失敗しました: ${error}`, isError: true };
  return {
    content: cap(text || "出力がありませんでした。", CODE_RESULT_CHARS),
    isError: false,
  };
}

/* ── web_fetch ────────────────────────────────────────────────────────────── */

/**
 * Refuses anything that is not a public web page.
 *
 * An agent can be talked into fetching a URL by a page it just read, so the
 * target is checked rather than trusted: non-HTTP schemes, credentials in the
 * URL, and hosts that resolve to the machine or the private network are all
 * refused. On a cloud host that private network includes the instance
 * metadata service, which is the one that actually hands out credentials.
 */
export function checkFetchUrl(raw: string): { ok: true; url: URL } | { ok: false; why: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, why: "URLとして読めません。" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, why: "http / https のURLだけ読み取れます。" };
  }
  if (url.username || url.password) {
    return { ok: false, why: "認証情報を含むURLは読み取りません。" };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    // IPv4 private, loopback, link-local (which includes cloud metadata) and
    // carrier-grade NAT ranges.
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
    /^0\./.test(host) ||
    // IPv6 loopback, unique-local and link-local.
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80")
  ) {
    return { ok: false, why: "社内・ローカルネットワークのURLは読み取りません。" };
  }

  return { ok: true, url };
}

export async function runWebFetch(
  raw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ content: string; isError: boolean }> {
  const checked = checkFetchUrl(raw.trim());
  if (!checked.ok) return { content: checked.why, isError: true };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetchImpl(checked.url.toString(), {
      // A redirect could leave the public web for a private address, so the
      // hop is inspected rather than followed blindly.
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "text/html,text/plain,application/json;q=0.9", "user-agent": "FRIDAY/1.0" },
      cache: "no-store",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { content: `リダイレクト先が不明です (${response.status})`, isError: true };
      const next = new URL(location, checked.url).toString();
      const recheck = checkFetchUrl(next);
      if (!recheck.ok) return { content: `リダイレクト先を読み取れません: ${recheck.why}`, isError: true };
      // One hop only; a chain is a sign the page does not want to be read.
      const hop = await fetchImpl(next, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "text/html,text/plain", "user-agent": "FRIDAY/1.0" },
        cache: "no-store",
      });
      if (!hop.ok) return { content: `ページを取得できませんでした (${hop.status})`, isError: true };
      return { content: await extract(hop), isError: false };
    }

    if (!response.ok) {
      return { content: `ページを取得できませんでした (${response.status})`, isError: true };
    }
    return { content: await extract(response), isError: false };
  } catch (error) {
    const message = (error as Error).name === "AbortError" ? "時間内に応答しませんでした。" : (error as Error).message;
    return { content: `ページを取得できませんでした: ${message}`, isError: true };
  } finally {
    clearTimeout(timer);
  }
}

async function extract(response: Response): Promise<string> {
  const type = response.headers.get("content-type") ?? "";
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > FETCH_MAX_BYTES) return "ページが大きすぎるため読み取りを中止しました。";

  const raw = await response.text();
  if (raw.length > FETCH_MAX_BYTES) {
    return cap(htmlToText(raw.slice(0, FETCH_MAX_BYTES)), FETCH_RESULT_CHARS);
  }
  if (/json/.test(type)) return cap(raw, FETCH_RESULT_CHARS);
  if (/html|xml/.test(type) || /^\s*<(!doctype|html)/i.test(raw)) {
    return cap(htmlToText(raw), FETCH_RESULT_CHARS);
  }
  return cap(raw, FETCH_RESULT_CHARS);
}

/**
 * Enough of a reader to get the prose out.
 *
 * Script, style and markup go; the title is kept because it is often the only
 * place the page says what it is.
 */
export function htmlToText(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return title ? `${title}\n\n${text}` : text;
}

function cap(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…（以下省略）`;
}
