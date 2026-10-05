/**
 * The provider-neutral shape of one model call.
 *
 * The agent loop used to speak the Anthropic SDK's types directly. It now
 * speaks these, and a provider translates them. The block shape is kept
 * deliberately Anthropic-like — `text` / `tool_use` / `tool_result` with the
 * same field names — for one concrete reason: a run that stops at the approval
 * gate persists its whole transcript to Supabase, and runs paused before this
 * migration must still resume afterwards. An equivalent-but-renamed shape
 * would have needed a data migration; this needs none.
 */

/** JSON Schema as the tools already declare it. Converted per provider. */
export type JsonSchema = Record<string, unknown>;

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema for the arguments. Unchanged from what the tool declares. */
  parameters: JsonSchema;
}

export type Block =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: unknown;
      /**
       * Gemini returns an opaque signature alongside a thinking model's
       * function call and rejects the follow-up turn if it is not echoed back
       * (finishReason MISSING_THOUGHT_SIGNATURE). Carried through the loop and
       * persisted with the transcript so a resumed run stays valid.
       */
      signature?: string;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
      /** Gemini keys a function response by name; Anthropic by id. */
      name?: string;
    };

export interface Msg {
  role: "user" | "assistant";
  /** A bare string is the same as one text block, as both APIs allow. */
  content: string | Block[];
}

export type StopReason =
  | "end"
  | "tool_use"
  | "max_tokens"
  /** Refused by safety classifiers. */
  | "refusal"
  /** The model emitted an unparseable function call. Retrying rarely helps. */
  | "malformed_tool_call"
  | "other";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Served from the provider's context cache, billed cheaper or not at all. */
  cachedTokens: number;
  /** Reasoning tokens, which bill as output. */
  thoughtTokens: number;
}

export interface ModelRequest {
  model: string;
  system: string;
  messages: Msg[];
  tools: ToolDef[];
  maxOutputTokens: number;
  /** Depth of internal reasoning. Mapped to whatever the provider calls it. */
  thinking: "off" | "low" | "medium" | "high";
}

export interface ModelResponse {
  blocks: Block[];
  stopReason: StopReason;
  /** Set when stopReason is "refusal". */
  refusalReason?: string;
  usage: Usage;
}

export type ProviderId = "gemini" | "anthropic" | "openai" | "stub";

/**
 * What a provider can do beyond generating text.
 *
 * Searching the web and running code are not universal. Gemini and Claude can
 * both do them, by different mechanisms; an OpenAI-compatible endpoint
 * generally cannot, and the list of those endpoints is open-ended (Groq,
 * DeepSeek, OpenRouter, a local model). Declaring it means the tools layer can
 * withhold a tool rather than offering one that always fails.
 */
export interface Capabilities {
  /** Grounded web search. Backs the web_search tool. */
  search: boolean;
  /** Sandboxed code execution. Backs the code_execution tool. */
  execute: boolean;
}

export interface SearchResult {
  text: string;
  sources: { title?: string; uri?: string }[];
  error?: string;
}

export interface Provider {
  /** Shown in the dashboard and the runtime badge. */
  readonly id: ProviderId;
  /** Human name for the settings screen. */
  readonly label: string;
  readonly capabilities: Capabilities;
  /**
   * One turn. Implementations stream internally — the loop needs the complete
   * turn before it can run tools, but streaming keeps a long turn from sitting
   * behind a single socket timeout, and it is what the provider's own API
   * recommends for long generations.
   */
  send(request: ModelRequest): Promise<ModelResponse>;
  /**
   * Grounded search, used by the web_search tool. Present when
   * `capabilities.search` is true. Each provider does this its own way — a
   * nested call carrying only that provider's own search tool — because none
   * of them allow a search tool and function declarations in one request.
   */
  search?(query: string): Promise<SearchResult>;
  /** Code execution, used by the code_execution tool. */
  execute?(task: string): Promise<SearchResult>;
}

/** Thrown with a message already written for the CEO to read. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** True when trying again later is the right advice. */
    readonly retryable: boolean,
    /**
     * How long to wait before trying again, when the API said so.
     *
     * Gemini returns this on a per-minute 429 as RetryInfo.retryDelay, and it
     * is the only authoritative answer: our own pacing counts what we sent,
     * while this counts what the service actually charged us for. Honouring
     * it turns a stopped run into a paused one.
     */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
