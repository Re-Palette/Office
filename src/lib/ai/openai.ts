import "server-only";

import {
  ProviderError,
  type Block,
  type ModelRequest,
  type ModelResponse,
  type Msg,
  type Provider,
  type StopReason,
  type ToolDef,
} from "./types";

/**
 * The OpenAI-compatible provider.
 *
 * This is one file but many backends: the chat-completions shape is what Groq,
 * DeepSeek, Mistral, Together, OpenRouter, a Vercel AI Gateway and a local
 * Ollama all speak. So the base URL is configuration, not code — pointing
 * OPENAI_BASE_URL somewhere else is the whole of "switching to that provider",
 * including to a model running on the CEO's own machine.
 *
 * It declares no search or code execution. Those are not part of this API
 * shape, and the list of endpoints behind it is open-ended, so claiming them
 * would mean offering the model tools that fail at the point of use. The tools
 * layer withholds them instead, and the employees that had them keep working
 * with their remaining tools. If search is wanted alongside one of these
 * models, FRIDAY_SEARCH_PROVIDER borrows it from a provider that has it.
 */

/* ── Conversion ───────────────────────────────────────────────────────────── */

function toTools(tools: ToolDef[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Flattens the transcript into chat-completions messages.
 *
 * This shape differs more than the others: tool calls hang off the assistant
 * message as `tool_calls` with stringified arguments, and each result is its
 * own message with `role: "tool"` rather than a block inside a user turn.
 */
export function toOpenAiMessages(system: string, messages: Msg[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (system.trim()) out.push({ role: "system", content: system });

  for (const message of messages) {
    if (typeof message.content === "string") {
      out.push({ role: message.role, content: message.content });
      continue;
    }

    if (message.role === "assistant") {
      const text = message.content
        .filter((b): b is Extract<Block, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const calls = message.content
        .filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use")
        .map((b) => ({
          id: b.id,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));

      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      });
      continue;
    }

    // A user turn carrying results becomes one message per result.
    const texts: string[] = [];
    for (const block of message.content) {
      if (block.type === "text") texts.push(block.text);
      else if (block.type === "tool_result") {
        out.push({
          role: "tool",
          tool_call_id: block.tool_use_id,
          content: block.is_error ? `ERROR: ${block.content}` : block.content,
        });
      }
    }
    if (texts.length > 0) out.push({ role: "user", content: texts.join("\n") });
  }

  return out;
}

const STOP: Record<string, StopReason> = {
  stop: "end",
  length: "max_tokens",
  tool_calls: "tool_use",
  function_call: "tool_use",
  content_filter: "refusal",
};

interface Completion {
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

let counter = 0;

export function fromCompletion(completion: Completion): ModelResponse {
  const choice = completion.choices?.[0];
  const blocks: Block[] = [];

  if (choice?.message?.content?.trim()) {
    blocks.push({ type: "text", text: choice.message.content.trim() });
  }

  for (const call of choice?.message?.tool_calls ?? []) {
    if (!call.function?.name) continue;
    let input: unknown = {};
    try {
      input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      // Unparseable arguments are the same failure Gemini reports as
      // MALFORMED_FUNCTION_CALL, and are surfaced the same way.
      return {
        blocks,
        stopReason: "malformed_tool_call",
        usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, thoughtTokens: 0 },
      };
    }
    blocks.push({
      type: "tool_use",
      // Some compatible endpoints omit the id; the loop needs one to match on.
      id: call.id || `oai-${Date.now().toString(36)}-${(counter++).toString(36)}`,
      name: call.function.name,
      input,
    });
  }

  const hasToolUse = blocks.some((b) => b.type === "tool_use");
  const reason = choice?.finish_reason ?? "";

  return {
    blocks,
    stopReason: hasToolUse ? "tool_use" : (STOP[reason] ?? "end"),
    refusalReason: reason === "content_filter" ? "content_filter" : undefined,
    usage: {
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      cachedTokens: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      thoughtTokens: completion.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    },
  };
}

/* ── Errors ───────────────────────────────────────────────────────────────── */

export function describeOpenAiError(
  status: number | null,
  body: string,
): { message: string; retryable: boolean } {
  const detail = body.slice(0, 400);

  if (status === 401 || status === 403) {
    return {
      message:
        "OPENAI_API_KEY が無効です。接続先（OPENAI_BASE_URL）に対して正しいキーか確認してください。",
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      message:
        /quota|billing|credit/i.test(body)
          ? `利用枠または残高が不足しています: ${detail}`
          : "レート制限に達しました。しばらく待って再実行してください。",
      retryable: false,
    };
  }
  if (status === 404) {
    return {
      message:
        `モデルまたはエンドポイントが見つかりません: ${detail}。` +
        "FRIDAY_MODEL と OPENAI_BASE_URL を確認してください。",
      retryable: false,
    };
  }
  if (status === 400) {
    return { message: `リクエストが拒否されました: ${detail}`, retryable: false };
  }
  if (status === 500 || status === 502 || status === 503) {
    return { message: "接続先が一時的に応答できませんでした。", retryable: true };
  }
  if (status === null) {
    return {
      message: "接続先に到達できませんでした。OPENAI_BASE_URL を確認してください。",
      retryable: true,
    };
  }
  return { message: `APIエラー (${status}): ${detail}`, retryable: false };
}

/* ── The provider ─────────────────────────────────────────────────────────── */

export interface OpenAiOptions {
  apiKey: string;
  /** Any OpenAI-compatible endpoint. Must include the version path. */
  baseUrl: string;
  /** Shown in the dashboard, since this one file serves many services. */
  label: string;
  fetchImpl?: typeof fetch;
}

export function createOpenAiProvider(options: OpenAiOptions): Provider {
  const doFetch = options.fetchImpl ?? fetch;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return {
    id: "openai",
    label: options.label,
    capabilities: { search: false, execute: false },

    async send(request: ModelRequest): Promise<ModelResponse> {
      const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.maxOutputTokens,
        messages: toOpenAiMessages(request.system, request.messages),
      };
      if (request.tools.length > 0) {
        body.tools = toTools(request.tools);
        body.tool_choice = "auto";
      }

      let lastError: ProviderError | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));

        let response: Response;
        try {
          response = await doFetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${options.apiKey}`,
            },
            body: JSON.stringify(body),
            cache: "no-store",
          });
        } catch (error) {
          const { message, retryable } = describeOpenAiError(null, (error as Error).message);
          lastError = new ProviderError(message, null, retryable);
          continue;
        }

        const text = await response.text().catch(() => "");
        if (!response.ok) {
          const { message, retryable } = describeOpenAiError(response.status, text);
          lastError = new ProviderError(message, response.status, retryable);
          if (!retryable) throw lastError;
          continue;
        }

        return fromCompletion(JSON.parse(text) as Completion);
      }

      throw lastError ?? new ProviderError("接続先が応答しませんでした。", null, true);
    },
  };
}
