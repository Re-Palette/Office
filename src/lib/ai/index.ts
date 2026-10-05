import "server-only";

import { getConfig } from "@/server/runtime/config";
import { createStubProvider } from "@/server/agents/stub-transport";
import { createAnthropicProvider } from "./anthropic";
import { createGeminiProvider } from "./gemini";
import { createOpenAiProvider } from "./openai";
import { markExhausted, notePerMinuteLimit, refund, reserveWithWait } from "./budget";
import { ProviderError, type Provider, type ProviderId, type SearchResult } from "./types";

/**
 * Where the model provider is chosen.
 *
 * The agent loop asks for a provider and never names one, so changing backend
 * is a setting rather than an edit. Adding a fourth is one file plus one line
 * in the table below; the loop, the tools and the UI do not change.
 *
 * Every provider here talks REST directly rather than through a vendor SDK.
 * That keeps the dependency list empty, makes the three read the same way, and
 * leaves retry policy in one place — which matters, because the policy is
 * deliberately "almost never", and an SDK's default is the opposite.
 */

const BUILDERS: Record<Exclude<ProviderId, "stub">, (cfg: ReturnType<typeof getConfig>) => Provider> = {
  gemini: (cfg) =>
    createGeminiProvider({
      apiKey: cfg.apiKey,
      searchModel: cfg.searchModel,
      // The provider retries a per-minute refusal itself; this is how the
      // pacer finds out, so the other agents slow down instead of each
      // discovering the same wall.
      onRateLimit: notePerMinuteLimit,
    }),

  anthropic: (cfg) =>
    createAnthropicProvider({
      apiKey: cfg.apiKey,
      searchModel: cfg.searchModel,
      searchTool: cfg.anthropicSearchTool,
      executeTool: cfg.anthropicExecuteTool,
    }),

  openai: (cfg) =>
    createOpenAiProvider({
      apiKey: cfg.apiKey,
      baseUrl: cfg.openAiBaseUrl,
      label: cfg.openAiLabel,
    }),
};

/**
 * Wraps a provider in the free-tier guard.
 *
 * Done here rather than in each provider so there is exactly one place a
 * request can be sent from, and so the count includes the nested search and
 * code-execution calls — which are the easiest ones to forget, and the ones
 * that multiply fastest.
 *
 * A failure that never reached the API gives its reservation back; a 429 that
 * names the daily quota is believed and stops the rest of the day.
 */
function guarded(provider: Provider): Provider {
  async function gate<T>(run: () => Promise<T>): Promise<T> {
    const verdict = await reserveWithWait();
    if (!verdict.ok) throw new ProviderError(verdict.reason ?? "上限に達しました。", 429, false);

    try {
      return await run();
    } catch (error) {
      if (error instanceof ProviderError) {
        if (error.status === 429 && /1日あたり|本日/.test(error.message)) markExhausted();
        // A refusal produced nothing, so it is not spent allowance. The
        // per-minute ceiling counts here too: the request never ran, and
        // charging it would shrink the day's work for no reason.
        else if (error.status === null || error.status === 429) refund();
      }
      throw error;
    }
  }

  return {
    ...provider,
    send: (request) => gate(() => provider.send(request)),
    ...(provider.search ? { search: (q: string) => gate(() => provider.search!(q)) } : {}),
    ...(provider.execute ? { execute: (t: string) => gate(() => provider.execute!(t)) } : {}),
  };
}

let cached: Provider | null = null;
let cachedKey = "";

export function getProvider(): Provider {
  const cfg = getConfig();
  // The key includes everything that would make a different provider, so a
  // changed setting takes effect without a restart.
  const key = cfg.testTransport
    ? "stub"
    : `${cfg.provider}:${cfg.openAiBaseUrl}:${cfg.apiKey.slice(-8)}`;

  if (!cached || cachedKey !== key) {
    cached = cfg.testTransport
      ? createStubProvider()
      : guarded(BUILDERS[cfg.provider](cfg));
    cachedKey = key;
  }
  return cached;
}

/**
 * The provider that backs web_search and code_execution.
 *
 * Normally the same one that answers the turns. It is separable because the
 * capability is not universal: an OpenAI-compatible endpoint has no grounded
 * search, so a Gemini key can supply search for a company whose employees
 * otherwise run on something else. FRIDAY_SEARCH_PROVIDER names it.
 */
export function getSearchProvider(): Provider {
  const cfg = getConfig();
  if (cfg.testTransport || !cfg.searchProvider || cfg.searchProvider === cfg.provider) {
    return getProvider();
  }
  const key = cfg.searchKeys[cfg.searchProvider];
  if (!key) return getProvider();

  return guarded(BUILDERS[cfg.searchProvider]({ ...cfg, apiKey: key }));
}

/** What the tools layer asks before offering web_search / code_execution. */
export function searchCapability(): { search: boolean; execute: boolean } {
  const provider = getSearchProvider();
  return {
    search: provider.capabilities.search && typeof provider.search === "function",
    execute: provider.capabilities.execute && typeof provider.execute === "function",
  };
}

export async function runSearch(query: string): Promise<SearchResult> {
  const provider = getSearchProvider();
  if (!provider.search) {
    return {
      text: "",
      sources: [],
      error:
        `現在の接続先（${provider.label}）はWeb検索に対応していません。` +
        "GEMINI_API_KEY を設定して FRIDAY_SEARCH_PROVIDER=gemini にすると検索だけを任せられます。",
    };
  }
  return provider.search(query);
}

export async function runExecute(task: string): Promise<SearchResult> {
  const provider = getSearchProvider();
  if (!provider.execute) {
    return {
      text: "",
      sources: [],
      error: `現在の接続先（${provider.label}）はコード実行に対応していません。`,
    };
  }
  return provider.execute(task);
}

/** Drops the cached provider so a changed key or backend takes effect. */
export function resetProvider(): void {
  cached = null;
  cachedKey = "";
}

export * from "./types";
