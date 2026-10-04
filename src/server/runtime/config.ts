import "server-only";

/**
 * Runtime configuration for the live agent layer.
 *
 * Without an API key the app stays in demo mode: the mock simulator drives the
 * dashboard exactly as before. With a key, AI employees run for real — they
 * call Gemini, use tools, and write their results back into the company state.
 */

export type RuntimeMode = "live" | "demo";

/**
 * Google is one OAuth client covering both Gmail and Calendar, so it is one
 * switch: either the AI employees can reach the CEO's inbox and diary, or they
 * cannot. A refresh token is used rather than a live consent flow so employees
 * working unattended still have valid credentials.
 */
export interface GoogleConfig {
  configured: boolean;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** The From address on anything sent. Blank means the authorised account. */
  sendAs: string;
  calendarId: string;
}

/**
 * note publishes no official write API.
 *
 * `output` decides what an AI employee's finished article becomes:
 *   "file"    — a Markdown document on disk and in the dashboard, which the
 *               CEO posts. Nothing touches note, so nothing can break. Default.
 *   "draft"   — saved to note as a private draft via its undocumented internal
 *               endpoints; the CEO publishes it there.
 *   "publish" — the same, and approval publishes it.
 *
 * The last two need `authToken`: the session cookie from the CEO's browser.
 */
export interface NoteConfig {
  output: "file" | "draft" | "publish";
  /** True when the unofficial API is both asked for and credentialed. */
  apiConfigured: boolean;
  authToken: string;
  session: string;
  /** What time the daily article job runs, as JST "HH:MM". */
  dailyDraftAt: string;
}

/**
 * Supabase, which is what makes the company's state survive on serverless.
 *
 * The service role key bypasses row-level security, so it lives here and never
 * leaves the server. Without both values the app falls back to a JSON file —
 * fine on a machine with a disk, lossy on a serverless instance.
 */
export interface SupabaseConfig {
  configured: boolean;
  url: string;
  serviceKey: string;
  /** Set when the values are present but structurally wrong. */
  misconfigured: string | null;
}

export interface RuntimeConfig {
  mode: RuntimeMode;
  hasApiKey: boolean;
  /** Which backend answers the turns. */
  provider: ProviderName;
  /** The active provider's key. Server-only; the UI never imports this. */
  apiKey: string;
  /**
   * The provider that backs web_search / code_execution, when it differs.
   * Null means "the same one". An OpenAI-compatible endpoint has no grounded
   * search, so this lets a Gemini key supply search and nothing else.
   */
  searchProvider: ProviderName | null;
  /** Keys for providers other than the active one, for the above. */
  searchKeys: Record<ProviderName, string>;
  /** Whether each provider's key is usable, blank, or absent. */
  keyStatus: Record<ProviderName, KeyStatus>;
  /** True when the active provider's variable exists but holds nothing. */
  keyBlank: boolean;
  /** Any OpenAI-compatible endpoint, including a local one. */
  openAiBaseUrl: string;
  /** What to call it in the dashboard, since one file serves many services. */
  openAiLabel: string;
  anthropicSearchTool: string;
  anthropicExecuteTool: string;
  /** Model the executives and report authors run on. */
  model: string;
  /** Model specialists run on. Cheaper than `model` by default. */
  workerModel: string;
  /**
   * Model for the nested single-purpose calls behind web_search and
   * code_execution. One agent turn can trigger several, so this is the
   * cheapest model by default.
   */
  searchModel: string;
  /** Ceiling on one turn's output. Kept modest so a run cannot run away. */
  maxOutputTokens: number;
  /**
   * Stay inside a free allowance: count requests per day, pace them per
   * minute, and stop before the wall rather than at it. On by default,
   * because the default provider is the one with a free tier.
   */
  freeTierGuard: boolean;
  /** Self-imposed daily request ceiling. 0 disables it. */
  dailyRequestBudget: number;
  /** Self-imposed per-minute ceiling. 0 disables pacing. */
  requestsPerMinute: number;
  /** How much reasoning budget a turn gets. */
  thinking: "off" | "low" | "medium" | "high";
  /** Hard ceiling on tool-use iterations per agent run. */
  maxSteps: number;
  /** Hard ceiling on delegations the COO may make in one command. */
  maxDelegations: number;
  /** Token ceiling handed to the model so it paces itself. */
  taskBudgetTokens: number;
  dataDir: string;
  webTools: boolean;
  google: GoogleConfig;
  note: NoteConfig;
  supabase: SupabaseConfig;
  codeExecution: boolean;
  /**
   * Development only. Runs the whole pipeline with a scripted stand-in for the
   * model so the workflow can be exercised without spending tokens.
   */
  testTransport: boolean;
}

/**
 * Defaults chosen for the free tier.
 *
 * Flash is the model the Gemini API's free tier actually serves; the Pro
 * models are paid-only. Lite is cheaper again and has a higher request
 * allowance, so delegated work and the nested search/compute calls run on it —
 * those are the calls that multiply. Both are overridable, because free-tier
 * availability moves and a model id that works today can 404 next month;
 * /api/diagnose lists what the key can actually reach.
 */
/**
 * Per-provider defaults.
 *
 * A model id only means something to the provider it belongs to, so switching
 * backend has to switch these too — otherwise FRIDAY_PROVIDER=anthropic asks
 * Claude for a Gemini model and gets a 404 that looks like a bug.
 */
const PROVIDER_DEFAULTS: Record<
  ProviderName,
  { model: string; workerModel: string; searchModel: string }
> = {
  // Flash-Lite everywhere. It is the cheapest tier with the largest request
  // allowance, which is the binding constraint on a free key — and the work
  // here is reading company data and writing Japanese prose, not reasoning
  // from scratch.
  //
  // 3.1 rather than 3.5: it is the documented upgrade path from the 2.5 line,
  // it is stable rather than preview, it is the cheaper of the two, and its
  // free allowance is the one Google actually publishes. 3.5-flash-lite is a
  // one-variable change for anyone who wants the newer model.
  //
  // These ids will go stale — the 2.5 line this replaced was retired within
  // months of being current, and returned 404 for new projects before its
  // announced date. That is why pickModel() below exists: a retired id is
  // recovered from the live model list rather than becoming an outage.
  gemini: {
    model: "gemini-3.1-flash-lite",
    workerModel: "gemini-3.1-flash-lite",
    searchModel: "gemini-3.1-flash-lite",
  },
  anthropic: {
    model: "claude-opus-5",
    workerModel: "claude-sonnet-5",
    searchModel: "claude-haiku-4-5-20251001",
  },
  // No default worth guessing: this one file serves every OpenAI-compatible
  // endpoint, and each has its own names. FRIDAY_MODEL is required.
  openai: { model: "", workerModel: "", searchModel: "" },
};

export type ProviderName = "gemini" | "anthropic" | "openai";

/** Which environment variable holds each provider's key. */
const KEY_VARS: Record<ProviderName, string[]> = {
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
  openai: ["OPENAI_API_KEY"],
};

/** Versioned server-tool identifiers, overridable as they are revised. */
const DEFAULT_ANTHROPIC_SEARCH_TOOL = "web_search_20260209";
const DEFAULT_ANTHROPIC_EXECUTE_TOOL = "code_execution_20260521";

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return !/^(0|false|off|no)$/i.test(value.trim());
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function str(value: string | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Cleans a credential pasted from somewhere else.
 *
 * The two things that reliably survive a copy-paste into a settings form are
 * the quotes from a .env file and the `NAME=` in front of the value. Both are
 * unambiguous — no real key contains either — so removing them is a fix, not a
 * guess, and it saves a round trip over a 401 that says nothing about why.
 */
export function cleanSecret(value: string | undefined): string {
  let v = str(value);
  // NAME=value, as pasted from a .env line.
  v = v.replace(/^[A-Z][A-Z0-9_]*\s*=\s*/, "");
  // Surrounding quotes, matching only.
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v.trim();
}

function googleConfig(): GoogleConfig {
  const clientId = str(process.env.GOOGLE_CLIENT_ID);
  const clientSecret = str(process.env.GOOGLE_CLIENT_SECRET);
  const refreshToken = str(process.env.GOOGLE_REFRESH_TOKEN);

  return {
    configured: Boolean(clientId && clientSecret && refreshToken),
    clientId,
    clientSecret,
    refreshToken,
    sendAs: str(process.env.GOOGLE_SEND_AS),
    calendarId: str(process.env.GOOGLE_CALENDAR_ID) || "primary",
  };
}

/**
 * Where the company's working state is written.
 *
 * A serverless filesystem is read-only apart from /tmp, so on Vercel the
 * project directory is not writable and the default has to move. /tmp is not
 * durable — it is per-instance and cleared between cold starts — so on Vercel
 * this is a working buffer, not storage. Phase 3 (Supabase) is what makes
 * state survive there; a normal server keeps everything in .friday as before.
 */
function dataDir(): string {
  const explicit = str(process.env.FRIDAY_DATA_DIR);
  if (explicit) return explicit;
  return process.env.VERCEL ? "/tmp/friday" : ".friday";
}

function noteConfig(): NoteConfig {
  const authToken = str(process.env.NOTE_AUTH_TOKEN);
  const requested = str(process.env.NOTE_OUTPUT);
  const wantsApi = requested === "draft" || requested === "publish";

  return {
    // Reaching note's private endpoints has to be asked for *and* credentialed.
    // Anything else falls back to the file, which always works.
    output: wantsApi && authToken ? (requested as "draft" | "publish") : "file",
    apiConfigured: wantsApi && Boolean(authToken),
    authToken,
    session: str(process.env.NOTE_SESSION),
    dailyDraftAt: /^\d{2}:\d{2}$/.test(str(process.env.NOTE_DAILY_DRAFT_AT))
      ? str(process.env.NOTE_DAILY_DRAFT_AT)
      : "17:00",
  };
}

/**
 * Checks the two values look like what they are supposed to be.
 *
 * Both are copied by hand from a dashboard that does not show them on the same
 * page, so the usual mistakes are structural: the dashboard URL instead of the
 * project's API URL, or the publishable key instead of the secret one. Caught
 * here, they are one sentence; caught at request time they are an opaque 401
 * or a stream of 404s.
 */
function isLocal(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

function checkSupabase(url: string, key: string): string | null {
  if (!url || !key) return null;

  let origin: URL;
  try {
    origin = new URL(url);
  } catch {
    return `SUPABASE_URL が URL として読めません（${url}）。https://<project-ref>.supabase.co の形式です。`;
  }

  // http is fine on a machine you control — a self-hosted Supabase on a
  // private network, or the loopback stub the self-test runs against. Over the
  // public internet it would put the secret key on the wire in the clear.
  if (origin.protocol !== "https:" && !isLocal(origin.hostname)) {
    return `SUPABASE_URL は https:// である必要があります（${origin.hostname}）。秘密鍵が平文で流れます。`;
  }
  if (origin.hostname === "supabase.com" || origin.hostname.endsWith(".supabase.com")) {
    return (
      "SUPABASE_URL にダッシュボードのURLが入っています。" +
      "Settings → Data API の Project URL（https://<project-ref>.supabase.co）を使ってください。"
    );
  }
  if (origin.pathname !== "/") {
    return `SUPABASE_URL にパスが含まれています（${origin.pathname}）。ホストまでで止めてください。`;
  }
  if (key.startsWith("sb_publishable_") || /"role":"anon"/.test(key)) {
    return (
      "publishable / anon キーが設定されています。これは行レベルセキュリティを迂回できないため読み書きできません。" +
      "Settings → API Keys の Secret keys（sb_secret_…）を使ってください。"
    );
  }

  return null;
}

function supabaseConfig(): SupabaseConfig {
  const url = cleanSecret(process.env.SUPABASE_URL).replace(/\/+$/, "");

  // Supabase renamed these: a modern "secret key" (sb_secret_…) is what the
  // old service_role key became. Both are accepted so the variable name never
  // has to match whichever generation of the dashboard someone copied from.
  const serviceKey =
    cleanSecret(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    cleanSecret(process.env.SUPABASE_SECRET_KEY);

  return {
    configured: Boolean(url && serviceKey),
    url,
    serviceKey,
    misconfigured: checkSupabase(url, serviceKey),
  };
}

/**
 * Whether a provider's key is usable, registered-but-blank, or not there.
 *
 * The middle case has to be its own answer. A hosting dashboard will happily
 * save an environment variable with an empty value, and the variable existing
 * is a clear statement of intent even when the value is useless — so it must
 * not read the same as the variable being absent.
 */
export type KeyStatus = "set" | "empty" | "absent";

function keyStatus(provider: ProviderName): KeyStatus {
  let sawVariable = false;
  for (const name of KEY_VARS[provider]) {
    if (process.env[name] === undefined) continue;
    sawVariable = true;
    if (cleanSecret(process.env[name])) return "set";
  }
  return sawVariable ? "empty" : "absent";
}

function keyFor(provider: ProviderName): string {
  for (const name of KEY_VARS[provider]) {
    const value = cleanSecret(process.env[name]);
    if (value) return value;
  }
  return "";
}

const ORDER: ProviderName[] = ["gemini", "anthropic", "openai"];

/**
 * Which backend to use.
 *
 * Named explicitly by FRIDAY_PROVIDER, or inferred from the keys — so setting
 * a key is enough and nothing has to be configured twice. Gemini is tried
 * first because it is the one with a free tier.
 *
 * A variable that exists claims its provider even when its value is blank,
 * and that is the whole point. A blank GEMINI_API_KEY used to fall straight
 * through to whichever other key was still lying around — in practice a
 * migrated-away-from Claude key with no credit on it. The company then ran on
 * a backend nobody had chosen and reported a billing problem for a product no
 * longer in use, which is a long way from the real cause. Holding the claim
 * means the failure says "that key is blank" instead of pointing elsewhere.
 *
 * A genuinely absent variable still falls through, which is the feature: one
 * key is all the configuration this needs.
 */
function resolveProvider(): ProviderName {
  const named = str(process.env.FRIDAY_PROVIDER).toLowerCase();
  if (named === "gemini" || named === "anthropic" || named === "openai") return named;
  if (named === "google") return "gemini";
  if (named === "claude") return "anthropic";

  // One pass, and a variable that merely exists is enough to claim it. A
  // blank value is a configuration error, and quietly using a different
  // backend instead would hide exactly the error worth reporting.
  for (const candidate of ORDER) {
    if (keyStatus(candidate) !== "absent") return candidate;
  }
  return "gemini";
}

/**
 * The model ids, resolved once.
 *
 * FRIDAY_MODEL is provider-neutral and wins, because it is the name that was
 * already in deployments. A value left over from a different backend would
 * 404 confusingly, so an id that plainly belongs to another provider is
 * ignored rather than passed through.
 */
function models(provider: ProviderName): {
  model: string;
  workerModel: string;
  searchModel: string;
} {
  const defaults = PROVIDER_DEFAULTS[provider];

  const sameFamily = (value: string): boolean => {
    if (!value) return false;
    const claude = /^claude/i.test(value);
    const gemini = /^gemini/i.test(value);
    if (provider === "anthropic") return !gemini;
    if (provider === "gemini") return !claude;
    // An OpenAI-compatible endpoint can serve any name, including these.
    return true;
  };

  const pick = (...candidates: (string | undefined)[]): string => {
    for (const candidate of candidates) {
      const value = str(candidate);
      if (sameFamily(value)) return value;
    }
    return "";
  };

  // Provider-specific names take precedence over the neutral ones.
  const specific =
    provider === "gemini"
      ? {
          model: process.env.GEMINI_MODEL,
          worker: process.env.GEMINI_WORKER_MODEL,
          search: process.env.GEMINI_SEARCH_MODEL,
        }
      : { model: undefined, worker: undefined, search: undefined };

  const model = pick(specific.model, process.env.FRIDAY_MODEL) || defaults.model;
  return {
    model,
    workerModel:
      pick(specific.worker, process.env.FRIDAY_WORKER_MODEL) || defaults.workerModel || model,
    searchModel:
      pick(specific.search, process.env.FRIDAY_SEARCH_MODEL) || defaults.searchModel || model,
  };
}

/** The provider that answers web_search, when it is not the active one. */
function resolveSearchProvider(active: ProviderName): ProviderName | null {
  const named = str(process.env.FRIDAY_SEARCH_PROVIDER).toLowerCase();
  if (named === "gemini" || named === "anthropic") return named;
  if (named === "google") return "gemini";
  if (named === "claude") return "anthropic";
  if (named === "off" || named === "none") return null;

  // Not named: an endpoint with no search of its own borrows one if a key for
  // a provider that has search happens to be present.
  if (active === "openai") {
    if (keyFor("gemini")) return "gemini";
    if (keyFor("anthropic")) return "anthropic";
  }
  return null;
}

/**
 * Reasoning depth.
 *
 * Low by default now: thinking tokens bill as output and count against the
 * per-minute token allowance, so on a free key they are paid for twice — once
 * in quota and once in the latency that brings the pacing limit closer. Low
 * still leaves the model enough to plan a tool call.
 */
function thinkingLevel(): RuntimeConfig["thinking"] {
  const value = str(process.env.GEMINI_THINKING).toLowerCase();
  return value === "off" || value === "low" || value === "medium" || value === "high"
    ? value
    : "low";
}

export function getConfig(): RuntimeConfig {
  const testTransport = bool(process.env.FRIDAY_TEST_TRANSPORT, false);
  const provider = resolveProvider();
  const apiKey = keyFor(provider);
  const hasApiKey = testTransport || Boolean(apiKey);

  return {
    mode: hasApiKey ? "live" : "demo",
    testTransport,
    hasApiKey,
    provider,
    apiKey,
    searchProvider: resolveSearchProvider(provider),
    searchKeys: {
      gemini: keyFor("gemini"),
      anthropic: keyFor("anthropic"),
      openai: keyFor("openai"),
    },
    keyStatus: {
      gemini: keyStatus("gemini"),
      anthropic: keyStatus("anthropic"),
      openai: keyStatus("openai"),
    },
    keyBlank: keyStatus(provider) === "empty",
    openAiBaseUrl: str(process.env.OPENAI_BASE_URL) || "https://api.openai.com/v1",
    openAiLabel: str(process.env.OPENAI_LABEL) || "OpenAI 互換",
    anthropicSearchTool:
      str(process.env.ANTHROPIC_SEARCH_TOOL) || DEFAULT_ANTHROPIC_SEARCH_TOOL,
    anthropicExecuteTool:
      str(process.env.ANTHROPIC_EXECUTE_TOOL) || DEFAULT_ANTHROPIC_EXECUTE_TOOL,
    ...models(provider),
    maxOutputTokens: int(process.env.GEMINI_MAX_OUTPUT_TOKENS, 4_096),
    // The guard matters on a free key and is noise on a paid one, so it
    // follows the provider unless it is asked for explicitly.
    freeTierGuard: bool(process.env.FRIDAY_FREE_TIER, provider === "gemini"),
    // Flash-Lite's published free allowance is 30 requests/minute and 1,500
    // requests/day. These sit at roughly a third and a half of that: enough
    // headroom that a normal day never reaches them, and enough margin that
    // a figure which turns out to be wrong does not cost the whole day. The
    // hard stop still comes from the API's own 429, never from this number.
    dailyRequestBudget: int(process.env.FRIDAY_DAILY_REQUEST_BUDGET, 500),
    requestsPerMinute: int(process.env.FRIDAY_REQUESTS_PER_MINUTE, 15),
    thinking: thinkingLevel(),
    // Lower than they were under a paid key: on the free tier every loop step
    // is one of a small number of requests per minute, so the ceilings double
    // as the thing that keeps one run from consuming the allowance.
    maxSteps: int(process.env.FRIDAY_MAX_STEPS, 12),
    maxDelegations: int(process.env.FRIDAY_MAX_DELEGATIONS, 3),
    taskBudgetTokens: int(process.env.FRIDAY_TASK_BUDGET, 60_000),
    dataDir: dataDir(),
    google: googleConfig(),
    note: noteConfig(),
    supabase: supabaseConfig(),
    webTools: bool(process.env.FRIDAY_WEB_TOOLS, true),
    codeExecution: bool(process.env.FRIDAY_CODE_EXECUTION, true),
  };
}

export interface StorageStatus {
  backend: "supabase" | "file";
  healthy: boolean;
  error: string | null;
}

/** Safe to expose to the browser — never includes the key itself. */
export interface PublicRuntimeStatus {
  mode: RuntimeMode;
  /** The backend in use, or "stub" for the scripted development transport. */
  transport: ProviderName | "stub";
  /** Its display name, which for an OpenAI-compatible endpoint is settable. */
  providerLabel: string;
  /** Whether web_search / code_execution are available on this backend. */
  modelCapabilities: { search: boolean; execute: boolean };
  /** Today's usage against the free allowance, for the dashboard. */
  quota: import("@/lib/ai/budget").QuotaStatus;
  /** Whether the company works on its own, and how much it has done today. */
  autonomy: import("@/server/autonomy").AutonomyStatus;
  model: string;
  workerModel: string;
  webTools: boolean;
  codeExecution: boolean;
  maxSteps: number;
  maxDelegations: number;
  /** Which external services are wired up. Never the credentials themselves. */
  integrations: { google: boolean; note: boolean };
  /** Where a finished note article goes, and when the daily job writes one. */
  noteOutput: NoteConfig["output"];
  noteDailyDraftAt: string;
  /**
   * Where this is running, and whether anything written survives.
   *
   * On serverless the only writable path is /tmp, which belongs to one
   * instance and is cleared on a cold start — so work written by the nightly
   * job may not be there when the dashboard asks for it. The UI says this out
   * loud rather than letting drafts appear and vanish unexplained.
   */
  platform: "vercel" | "server";
  persistence: "durable" | "ephemeral";
  /** What is actually holding the state, and whether it is reachable. */
  storage: "supabase" | "file";
  /** False when Supabase is configured but the last call to it failed. */
  storageHealthy: boolean;
  storageError: string | null;
}

const PROVIDER_LABELS: Record<ProviderName, string> = {
  gemini: "Google Gemini",
  anthropic: "Anthropic Claude",
  openai: "OpenAI 互換",
};

function providerLabel(c: RuntimeConfig): string {
  if (c.testTransport) return "スタブ（開発用）";
  return c.provider === "openai" ? c.openAiLabel : PROVIDER_LABELS[c.provider];
}

/**
 * `storage` and `capabilities` are passed in rather than read here, so this
 * module stays free of any dependency on the store or the provider registry —
 * both of which depend on it.
 */
export function publicStatus(
  storage: StorageStatus,
  capabilities: { search: boolean; execute: boolean },
  quota: import("@/lib/ai/budget").QuotaStatus,
  autonomy: import("@/server/autonomy").AutonomyStatus,
): PublicRuntimeStatus {
  const c = getConfig();
  return {
    mode: c.mode,
    transport: c.testTransport ? "stub" : c.provider,
    providerLabel: providerLabel(c),
    modelCapabilities: capabilities,
    quota,
    autonomy,
    model: c.model,
    workerModel: c.workerModel,
    webTools: c.webTools,
    codeExecution: c.codeExecution,
    maxSteps: c.maxSteps,
    maxDelegations: c.maxDelegations,
    // note always works: with no credentials it writes a file instead.
    integrations: { google: c.google.configured, note: true },
    noteOutput: c.note.output,
    noteDailyDraftAt: c.note.dailyDraftAt,
    platform: process.env.VERCEL ? "vercel" : "server",
    // Supabase is durable anywhere. Without it, a normal server's disk still
    // survives a restart; a serverless instance's /tmp does not.
    // Configured is not the same as working: a bad key would otherwise read
    // as durable right up until the first thing quietly failed to save.
    persistence:
      (storage.backend === "supabase" && storage.healthy) || !process.env.VERCEL
        ? "durable"
        : "ephemeral",
    storage: storage.backend,
    storageHealthy: storage.healthy,
    storageError: storage.error,
  };
}
