import "server-only";

import {
  ProviderError,
  type Block,
  type JsonSchema,
  type ModelRequest,
  type ModelResponse,
  type Msg,
  type Provider,
  type SearchResult,
  type StopReason,
  type ToolDef,
  type Usage,
} from "./types";

/**
 * The Gemini provider, spoken over the REST API directly.
 *
 * No SDK: the rest of this codebase already talks to Supabase, Google OAuth
 * and note over plain `fetch`, and the one thing a model SDK would add here —
 * retry and backoff — is precisely what must NOT happen on a free-tier key.
 * The wire format is taken from the published discovery document rather than
 * memory, which is also where the two non-obvious requirements below come
 * from.
 *
 * Verified against generativelanguage v1beta, revision 2026-10-02:
 *   - `Schema.type` is an uppercase enum (OBJECT, STRING, …) and the schema
 *     has no `additionalProperties`, so tool schemas are converted, not passed
 *     through. Unknown keywords are dropped rather than sent and rejected.
 *   - A thinking model returns `thoughtSignature` on its function-call parts
 *     and rejects the next turn without it (finishReason
 *     MISSING_THOUGHT_SIGNATURE), so signatures round-trip.
 */

const HOST = "https://generativelanguage.googleapis.com/v1beta";

/* ── Tool schema conversion ───────────────────────────────────────────────── */

/** Keys Gemini's Schema actually has. Anything else is dropped, not sent. */
const SCHEMA_KEYS = new Set([
  "type", "format", "title", "description", "nullable", "enum", "items",
  "properties", "required", "minimum", "maximum", "minItems", "maxItems",
  "minLength", "maxLength", "pattern", "default", "anyOf", "propertyOrdering",
]);

const TYPES = new Set(["STRING", "NUMBER", "INTEGER", "BOOLEAN", "ARRAY", "OBJECT", "NULL"]);

/**
 * Rewrites a JSON Schema into Gemini's subset.
 *
 * The tools' own declarations are left untouched; only the wire encoding
 * changes. `additionalProperties: false` is the one thing every tool here sets
 * and Gemini has no field for — dropping it loosens nothing that matters,
 * because unknown arguments are ignored by the tool implementations anyway.
 */
export function toGeminiSchema(schema: JsonSchema): JsonSchema {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (!SCHEMA_KEYS.has(key)) continue;

    if (key === "type" && typeof value === "string") {
      const upper = value.toUpperCase();
      // An unrecognised type would be rejected; leaving it out lets the model
      // infer from the description, which is better than a 400.
      if (TYPES.has(upper)) out.type = upper;
      continue;
    }
    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, JsonSchema>).map(([k, v]) => [
          k,
          toGeminiSchema(v),
        ]),
      );
      continue;
    }
    if (key === "items" && value && typeof value === "object") {
      out.items = toGeminiSchema(value as JsonSchema);
      continue;
    }
    if (key === "anyOf" && Array.isArray(value)) {
      out.anyOf = value.map((v) => toGeminiSchema(v as JsonSchema));
      continue;
    }
    out[key] = value;
  }

  return out;
}

function toFunctionDeclarations(tools: ToolDef[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: toGeminiSchema(tool.parameters),
  }));
}

/* ── Transcript conversion ────────────────────────────────────────────────── */

type Part = Record<string, unknown>;

/**
 * Turns the loop's transcript into Gemini `contents`.
 *
 * Two shape differences are absorbed here. Gemini calls the assistant "model",
 * and it carries tool results as `functionResponse` parts in a *user* turn
 * keyed by function name — where Anthropic keys them by the call's id. The
 * name is recovered from the matching call when an older persisted transcript
 * does not carry one.
 */
export function toGeminiContents(messages: Msg[]): { role: string; parts: Part[] }[] {
  // id → name, so a tool_result from a pre-migration transcript still resolves.
  const callNames = new Map<string, string>();
  for (const message of messages) {
    if (typeof message.content === "string") continue;
    for (const block of message.content) {
      if (block.type === "tool_use") callNames.set(block.id, block.name);
    }
  }

  const contents: { role: string; parts: Part[] }[] = [];

  for (const message of messages) {
    const role = message.role === "assistant" ? "model" : "user";

    if (typeof message.content === "string") {
      if (message.content.trim()) contents.push({ role, parts: [{ text: message.content }] });
      continue;
    }

    const parts: Part[] = [];
    for (const block of message.content) {
      if (block.type === "text") {
        if (block.text.trim()) parts.push({ text: block.text });
      } else if (block.type === "tool_use") {
        const part: Part = {
          functionCall: { name: block.name, args: block.input ?? {} },
        };
        // Required for a thinking model, and harmless when absent.
        if (block.signature) part.thoughtSignature = block.signature;
        parts.push(part);
      } else {
        const name = block.name ?? callNames.get(block.tool_use_id) ?? "unknown";
        parts.push({
          functionResponse: {
            name,
            // Gemini wants a JSON object; an error is reported in-band so the
            // model reads it as a result rather than a transport failure.
            response: block.is_error
              ? { error: block.content }
              : { result: block.content },
          },
        });
      }
    }

    if (parts.length > 0) contents.push({ role, parts });
  }

  return contents;
}

/* ── Response conversion ──────────────────────────────────────────────────── */

const STOP: Record<string, StopReason> = {
  STOP: "end",
  MAX_TOKENS: "max_tokens",
  SAFETY: "refusal",
  PROHIBITED_CONTENT: "refusal",
  BLOCKLIST: "refusal",
  SPII: "refusal",
  RECITATION: "refusal",
  MALFORMED_FUNCTION_CALL: "malformed_tool_call",
  MISSING_THOUGHT_SIGNATURE: "malformed_tool_call",
};

let callCounter = 0;
const nextCallId = () => `gem-${Date.now().toString(36)}-${(callCounter++).toString(36)}`;

interface GeminiChunk {
  candidates?: {
    content?: { parts?: Part[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
}

/**
 * Folds the streamed chunks into one turn.
 *
 * Text arrives in pieces and is concatenated; a function call arrives whole.
 * `thought` parts are the model's reasoning and are deliberately dropped —
 * they are not shown to the CEO and must not be fed back as content — but the
 * signature attached to a call part is kept, because the next turn needs it.
 */
export function foldChunks(chunks: GeminiChunk[]): ModelResponse {
  let text = "";
  const toolUses: Block[] = [];
  let finishReason = "";
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, thoughtTokens: 0 };
  let blockReason = "";

  for (const chunk of chunks) {
    if (chunk.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason;

    // Usage is cumulative per chunk, so the last one wins rather than summing.
    const u = chunk.usageMetadata;
    if (u) {
      usage.inputTokens = u.promptTokenCount ?? usage.inputTokens;
      usage.outputTokens = u.candidatesTokenCount ?? usage.outputTokens;
      usage.cachedTokens = u.cachedContentTokenCount ?? usage.cachedTokens;
      usage.thoughtTokens = u.thoughtsTokenCount ?? usage.thoughtTokens;
    }

    const candidate = chunk.candidates?.[0];
    if (candidate?.finishReason) finishReason = candidate.finishReason;

    for (const part of candidate?.content?.parts ?? []) {
      if (part.thought === true) continue;
      if (typeof part.text === "string") text += part.text;

      const call = part.functionCall as { name?: string; args?: unknown } | undefined;
      if (call?.name) {
        toolUses.push({
          type: "tool_use",
          id: nextCallId(),
          name: call.name,
          input: call.args ?? {},
          signature:
            typeof part.thoughtSignature === "string" ? part.thoughtSignature : undefined,
        });
      }
    }
  }

  const blocks: Block[] = [];
  if (text.trim()) blocks.push({ type: "text", text: text.trim() });
  blocks.push(...toolUses);

  // A tool call is what the loop acts on, whatever the reported reason.
  let stopReason: StopReason =
    toolUses.length > 0 ? "tool_use" : (STOP[finishReason] ?? (finishReason ? "other" : "end"));

  // Nothing came back at all: the prompt itself was blocked upstream.
  if (blocks.length === 0 && blockReason) stopReason = "refusal";

  return {
    blocks,
    stopReason,
    refusalReason:
      stopReason === "refusal" ? blockReason || finishReason || "safety" : undefined,
    usage,
  };
}

/* ── Errors ───────────────────────────────────────────────────────────────── */

/**
 * Turns a Gemini failure into something the CEO can act on.
 *
 * 429 is the one that matters on a free key, and it is deliberately NOT
 * retryable here: the quota is per minute or per day, so an automatic retry
 * either fails again immediately or burns the next window. Saying which it is,
 * and stopping, is more useful than trying again.
 *
 * Split out as a pure function so it can be tested without a network call.
 */
export function describeGeminiError(status: number | null, body: string): {
  message: string;
  retryable: boolean;
} {
  const detail = body.slice(0, 400);

  if (status === 429) {
    const daily = /per day|PerDay|requests per day/i.test(body);
    return {
      message: daily
        ? "Gemini APIの1日あたりの無料枠を使い切りました。日付が変わる（太平洋時間の0時）まで待つか、" +
          "Google AI Studio で課金を有効にしてください。自動で再試行はしません。"
        : "Gemini APIのレート制限に達しました（1分あたりの回数上限）。1分ほど待ってから再実行してください。",
      retryable: false,
    };
  }
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(body)) {
    return {
      message:
        "GEMINI_API_KEY が無効です。Google AI Studio（aistudio.google.com/apikey）で発行した" +
        "キーをそのまま設定してください。",
      retryable: false,
    };
  }
  if (status === 403) {
    return {
      message:
        "Gemini APIへのアクセスが拒否されました（403）。キーが有効か、使用しているモデルが" +
        "そのキーで利用できるかを確認してください。",
      retryable: false,
    };
  }
  if (status === 404) {
    return {
      message:
        `指定したモデルが見つかりません: ${detail}。` +
        "GEMINI_MODEL に利用可能なモデルIDを設定してください（/api/diagnose で一覧を確認できます）。",
      retryable: false,
    };
  }
  if (status === 400) {
    return {
      message: `リクエストがGemini APIに拒否されました（実装側の問題です）: ${detail}`,
      retryable: false,
    };
  }
  if (status === 500 || status === 503 || status === 504) {
    return {
      message: "Gemini APIが一時的に応答できませんでした。しばらく待って再実行してください。",
      retryable: true,
    };
  }
  if (status === null) {
    return {
      message: "Gemini API へ接続できませんでした。ネットワークを確認してください。",
      retryable: true,
    };
  }
  return { message: `Gemini API エラー (${status}): ${detail}`, retryable: false };
}

/* ── Thinking ─────────────────────────────────────────────────────────────── */

/**
 * Maps the loop's intent onto a token budget.
 *
 * `thinkingLevel` is the newer field but errors on pre-Gemini-3 models, and
 * the free tier's model is a 2.5, so a budget is used: it is accepted by both
 * generations. -1 would let the model decide and spend freely; these are
 * fixed ceilings so a single run cannot quietly consume the day's quota.
 */
export function thinkingBudget(level: ModelRequest["thinking"]): number {
  switch (level) {
    case "off":
      return 0;
    case "low":
      return 1024;
    case "medium":
      return 4096;
    case "high":
      return 8192;
  }
}

/* ── The provider ─────────────────────────────────────────────────────────── */

export interface GeminiOptions {
  apiKey: string;
  /**
   * Model for the nested search / code-execution calls. One agent turn can
   * trigger several, so this is normally the cheapest model available.
   */
  searchModel: string;
  /** Lets the self-test drive the provider without a network. */
  fetchImpl?: typeof fetch;
}

export function createGeminiProvider(options: GeminiOptions): Provider {
  const doFetch = options.fetchImpl ?? fetch;

  return {
    id: "gemini",
    label: "Google Gemini",
    // Both are real, but neither can be sent alongside function
    // declarations, so each runs as its own nested call below.
    capabilities: { search: true, execute: true },

    search: (query: string) =>
      nested(
        doFetch,
        options,
        { googleSearch: {} },
        query,
        "ユーザーの問いに、Google検索の結果だけを根拠に答えてください。" +
          "事実と、その出典を簡潔に示します。推測は書かず、分からなければ分からないと書いてください。",
      ),

    execute: (task: string) =>
      nested(
        doFetch,
        options,
        { codeExecution: {} },
        task,
        "Pythonコードを書いて実行し、計算結果を返してください。" +
          "値は与えられたものだけを使い、足りなければ何が足りないかを書いてください。",
      ),

    async send(request: ModelRequest): Promise<ModelResponse> {
      const body: Record<string, unknown> = {
        contents: toGeminiContents(request.messages),
        generationConfig: {
          maxOutputTokens: request.maxOutputTokens,
          thinkingConfig: { thinkingBudget: thinkingBudget(request.thinking) },
        },
      };

      if (request.system.trim()) {
        body.systemInstruction = { parts: [{ text: request.system }] };
      }
      if (request.tools.length > 0) {
        body.tools = [{ functionDeclarations: toFunctionDeclarations(request.tools) }];
        body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
      }

      const url =
        `${HOST}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`;

      // One retry, and only for a transient server fault. A quota error is
      // never retried — see describeGeminiError.
      let lastError: ProviderError | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));

        let response: Response;
        try {
          response = await doFetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": options.apiKey,
            },
            body: JSON.stringify(body),
            cache: "no-store",
          });
        } catch (error) {
          const { message, retryable } = describeGeminiError(null, (error as Error).message);
          lastError = new ProviderError(message, null, retryable);
          continue;
        }

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          const { message, retryable } = describeGeminiError(response.status, text);
          lastError = new ProviderError(message, response.status, retryable);
          if (!retryable) throw lastError;
          continue;
        }

        return foldChunks(await readSse(response));
      }

      throw lastError ?? new ProviderError("Gemini API が応答しませんでした。", null, true);
    },
  };
}

/**
 * Reads an `alt=sse` stream into its chunks.
 *
 * Each event is one complete `GenerateContentResponse`, so parsing is per
 * `data:` line and a partial line is carried over to the next read.
 */
export async function readSse(response: Response): Promise<GeminiChunk[]> {
  const chunks: GeminiChunk[] = [];
  const body = response.body;

  if (!body) {
    // No stream to read (a stubbed fetch, or a proxy that buffered it).
    const text = await response.text().catch(() => "");
    return parseSseText(text);
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const chunk = parseSseLine(line);
        if (chunk) chunks.push(chunk);
      }
    }
    const tail = parseSseLine(buffer);
    if (tail) chunks.push(tail);
  } finally {
    reader.releaseLock();
  }

  return chunks;
}

function parseSseText(text: string): GeminiChunk[] {
  const chunks: GeminiChunk[] = [];
  for (const line of text.split("\n")) {
    const chunk = parseSseLine(line);
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function parseSseLine(line: string): GeminiChunk | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    return JSON.parse(payload) as GeminiChunk;
  } catch {
    // A malformed event is skipped rather than failing the whole turn.
    return null;
  }
}

/* ── Which models this key can actually use ───────────────────────────────── */

/**
 * Lists the models the key has access to.
 *
 * Free-tier availability moves, and a model id that was fine last month now
 * 404s. Rather than hard-coding a list that goes stale, the setup check asks.
 */
export async function listGeminiModels(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    const response = await fetchImpl(`${HOST}/models?pageSize=200`, {
      headers: { "x-goog-api-key": apiKey },
      cache: "no-store",
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      return { ok: false, models: [], error: describeGeminiError(response.status, text).message };
    }
    const parsed = JSON.parse(text) as {
      models?: { name?: string; supportedGenerationMethods?: string[] }[];
    };
    const models = (parsed.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .filter(Boolean)
      .sort();
    return { ok: true, models };
  } catch (error) {
    return { ok: false, models: [], error: (error as Error).message };
  }
}


/* ── The nested single-purpose call ───────────────────────────────────────── */

/**
 * One request carrying exactly one built-in tool and no function
 * declarations, which is the combination Gemini allows.
 *
 * Thinking is off: this is a lookup, and a reasoning budget here would come
 * out of the same quota the agent's own turns need.
 */
async function nested(
  doFetch: typeof fetch,
  options: GeminiOptions,
  tool: Record<string, unknown>,
  prompt: string,
  system: string,
): Promise<SearchResult> {
  const url =
    `${HOST}/models/${encodeURIComponent(options.searchModel)}:streamGenerateContent?alt=sse`;

  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: system }] },
        tools: [tool],
        generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
      }),
      cache: "no-store",
    });
  } catch (error) {
    return { text: "", sources: [], error: describeGeminiError(null, (error as Error).message).message };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { text: "", sources: [], error: describeGeminiError(response.status, body).message };
  }

  const chunks = (await readSse(response)) as unknown as {
    candidates?: {
      content?: { parts?: Record<string, unknown>[] };
      groundingMetadata?: { groundingChunks?: { web?: { title?: string; uri?: string } }[] };
    }[];
  }[];

  let text = "";
  const sources: { title?: string; uri?: string }[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const candidate = chunk.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.thought === true) continue;
      if (typeof part.text === "string") text += part.text;

      // Code execution reports back as its own part types.
      const code = part.executableCode as { code?: string } | undefined;
      if (code?.code) text += `\n[実行したコード]\n${code.code}\n`;
      const result = part.codeExecutionResult as { outcome?: string; output?: string } | undefined;
      if (result) {
        const bad = result.outcome && result.outcome !== "OUTCOME_OK" ? ` ${result.outcome}` : "";
        text += `\n[実行結果${bad}]\n${result.output ?? ""}\n`;
      }
    }
    for (const g of candidate?.groundingMetadata?.groundingChunks ?? []) {
      const uri = g.web?.uri;
      if (uri && !seen.has(uri)) {
        seen.add(uri);
        sources.push(g.web ?? {});
      }
    }
  }

  return { text: text.trim(), sources };
}
