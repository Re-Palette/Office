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
} from "./types";

/**
 * The Claude provider.
 *
 * Spoken over REST for the same reason Gemini is: the SDK's one real
 * contribution here is automatic retry, which is the behaviour this codebase
 * deliberately does not want on a metered key.
 *
 * This is also the proof that the provider seam is real. Claude was the
 * original backend; it now sits behind the same interface as everything else,
 * so going back to it is an environment variable rather than a migration.
 *
 * Two things it does that Gemini cannot:
 *   - tool schemas pass through untouched (`input_schema` is plain JSON Schema)
 *   - prompt caching, which matters because the 48 employees share a long
 *     system prompt and re-send it on every turn
 */

const HOST = "https://api.anthropic.com/v1";
const VERSION = "2023-06-01";

/* ── Conversion ───────────────────────────────────────────────────────────── */

function toTools(tools: ToolDef[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    // Claude takes JSON Schema as written, so nothing is dropped or renamed.
    input_schema: tool.parameters as JsonSchema,
  }));
}

/**
 * The transcript needs almost no conversion: the neutral block shape was
 * modelled on this one so paused runs could survive a provider change.
 */
export function toAnthropicMessages(messages: Msg[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return { role: message.role, content: message.content };
    }
    return {
      role: message.role,
      content: message.content.map((block) => {
        if (block.type === "text") return { type: "text", text: block.text };
        if (block.type === "tool_use") {
          return { type: "tool_use", id: block.id, name: block.name, input: block.input ?? {} };
        }
        return {
          type: "tool_result",
          tool_use_id: block.tool_use_id,
          content: block.content,
          ...(block.is_error ? { is_error: true } : {}),
        };
      }),
    };
  });
}

const STOP: Record<string, StopReason> = {
  end_turn: "end",
  stop_sequence: "end",
  tool_use: "tool_use",
  max_tokens: "max_tokens",
  refusal: "refusal",
  pause_turn: "tool_use",
};

interface AnthropicMessage {
  content?: {
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }[];
  stop_reason?: string;
  stop_details?: { category?: string };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export function fromAnthropicMessage(message: AnthropicMessage): ModelResponse {
  const blocks: Block[] = [];

  for (const block of message.content ?? []) {
    if (block.type === "text" && block.text?.trim()) {
      blocks.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use" && block.id && block.name) {
      blocks.push({ type: "tool_use", id: block.id, name: block.name, input: block.input ?? {} });
    }
  }

  const hasToolUse = blocks.some((b) => b.type === "tool_use");
  const reason = message.stop_reason ?? "";

  return {
    blocks,
    stopReason: hasToolUse ? "tool_use" : (STOP[reason] ?? "end"),
    refusalReason: reason === "refusal" ? (message.stop_details?.category ?? "refusal") : undefined,
    usage: {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
      cachedTokens: message.usage?.cache_read_input_tokens ?? 0,
      thoughtTokens: 0,
    },
  };
}

/* ── Errors ───────────────────────────────────────────────────────────────── */

export function describeAnthropicError(
  status: number | null,
  body: string,
): { message: string; retryable: boolean } {
  const detail = body.slice(0, 400);

  if (status === 401 || status === 403) {
    return {
      message: "ANTHROPIC_API_KEY が無効です。console.anthropic.com で確認してください。",
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      message: "Claude APIのレート制限に達しました。しばらく待って再実行してください。",
      retryable: false,
    };
  }
  if (/credit balance is too low|Plans & Billing/i.test(body)) {
    return {
      message:
        "Anthropic APIのクレジット残高が不足しています。console.anthropic.com の " +
        "Plans & Billing でクレジットを購入してください（Claudeの月額プランとは別枠です）。",
      retryable: false,
    };
  }
  if (/Schema is too complex|input_schema|tools\./i.test(body)) {
    return {
      message: `ツール定義がAPIに拒否されました（実装側の問題です）: ${detail}`,
      retryable: false,
    };
  }
  if (status === 404 || /not_found_error|does not exist/i.test(body)) {
    return {
      message: `モデルを利用できません: ${detail}。FRIDAY_MODEL を確認してください。`,
      retryable: false,
    };
  }
  if (status === 500 || status === 503 || status === 529) {
    return {
      message: "Claude APIが一時的に応答できませんでした。しばらく待って再実行してください。",
      retryable: true,
    };
  }
  if (status === null) {
    return { message: "Claude API へ接続できませんでした。", retryable: true };
  }
  return { message: `Claude API エラー (${status}): ${detail}`, retryable: false };
}

/* ── The provider ─────────────────────────────────────────────────────────── */

export interface AnthropicOptions {
  apiKey: string;
  /** Model for the nested search call. */
  searchModel: string;
  /** Server-side search and code execution, which this API hosts itself. */
  searchTool: string;
  executeTool: string;
  fetchImpl?: typeof fetch;
}

export function createAnthropicProvider(options: AnthropicOptions): Provider {
  const doFetch = options.fetchImpl ?? fetch;

  async function call(body: Record<string, unknown>): Promise<AnthropicMessage> {
    let lastError: ProviderError | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));

      let response: Response;
      try {
        response = await doFetch(`${HOST}/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": options.apiKey,
            "anthropic-version": VERSION,
          },
          body: JSON.stringify(body),
          cache: "no-store",
        });
      } catch (error) {
        const { message, retryable } = describeAnthropicError(null, (error as Error).message);
        lastError = new ProviderError(message, null, retryable);
        continue;
      }

      const text = await response.text().catch(() => "");
      if (!response.ok) {
        const { message, retryable } = describeAnthropicError(response.status, text);
        lastError = new ProviderError(message, response.status, retryable);
        if (!retryable) throw lastError;
        continue;
      }
      return JSON.parse(text) as AnthropicMessage;
    }

    throw lastError ?? new ProviderError("Claude API が応答しませんでした。", null, true);
  }

  /** A nested call carrying only a server-side tool, mirroring Gemini's. */
  async function nested(tool: Record<string, unknown>, prompt: string): Promise<SearchResult> {
    try {
      const message = await call({
        model: options.searchModel,
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
        tools: [tool],
      });
      const text = (message.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n")
        .trim();
      return { text, sources: [] };
    } catch (error) {
      return { text: "", sources: [], error: (error as Error).message };
    }
  }

  return {
    id: "anthropic",
    label: "Anthropic Claude",
    capabilities: { search: true, execute: true },

    search: (query) =>
      nested(
        { type: options.searchTool, name: "web_search", max_uses: 5 },
        `次について調べ、事実と出典を簡潔にまとめてください。推測は書かないでください。\n\n${query}`,
      ),

    execute: (task) =>
      nested(
        { type: options.executeTool, name: "code_execution" },
        `次の計算をPythonで実行し、結果を示してください。\n\n${task}`,
      ),

    async send(request: ModelRequest): Promise<ModelResponse> {
      const message = await call({
        model: request.model,
        max_tokens: request.maxOutputTokens,
        // The 48 employees share a long system prompt and re-send it every
        // turn, so caching it is the single largest saving available here.
        system: [
          { type: "text", text: request.system, cache_control: { type: "ephemeral" } },
        ],
        messages: toAnthropicMessages(request.messages),
        ...(request.tools.length > 0 ? { tools: toTools(request.tools) } : {}),
        ...(request.thinking === "off" ? {} : { thinking: { type: "adaptive" } }),
      });

      return fromAnthropicMessage(message);
    },
  };
}
