import "server-only";

/**
 * Runtime configuration for the live agent layer.
 *
 * Without an API key the app stays in demo mode: the mock simulator drives the
 * dashboard exactly as before. With a key, AI employees run for real — they
 * call Claude, use tools, and write their results back into the company state.
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
}

export interface RuntimeConfig {
  mode: RuntimeMode;
  hasApiKey: boolean;
  /** Model the executives and report authors run on. */
  model: string;
  /** Model specialists run on. Same as `model` unless the CEO lowers it. */
  workerModel: string;
  /** Hard ceiling on tool-use iterations per agent run. */
  maxSteps: number;
  /** Hard ceiling on delegations the COO may make in one command. */
  maxDelegations: number;
  /** Token ceiling handed to Claude so it paces itself. */
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

const DEFAULT_MODEL = "claude-opus-5";

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

function supabaseConfig(): SupabaseConfig {
  const url = str(process.env.SUPABASE_URL).replace(/\/+$/, "");

  // Supabase renamed these: a modern "secret key" (sb_secret_…) is what the
  // old service_role key became. Both are accepted so the variable name never
  // has to match whichever generation of the dashboard someone copied from.
  const serviceKey =
    str(process.env.SUPABASE_SERVICE_ROLE_KEY) || str(process.env.SUPABASE_SECRET_KEY);

  return { configured: Boolean(url && serviceKey), url, serviceKey };
}

export function getConfig(): RuntimeConfig {
  const testTransport = bool(process.env.FRIDAY_TEST_TRANSPORT, false);
  const hasApiKey =
    testTransport ||
    Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim());

  return {
    mode: hasApiKey ? "live" : "demo",
    testTransport,
    hasApiKey,
    model: process.env.FRIDAY_MODEL?.trim() || DEFAULT_MODEL,
    workerModel:
      process.env.FRIDAY_WORKER_MODEL?.trim() ||
      process.env.FRIDAY_MODEL?.trim() ||
      DEFAULT_MODEL,
    maxSteps: int(process.env.FRIDAY_MAX_STEPS, 24),
    maxDelegations: int(process.env.FRIDAY_MAX_DELEGATIONS, 5),
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
  /** "claude" is the real API; "stub" is the scripted development transport. */
  transport: "claude" | "stub";
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

/**
 * `storage` is passed in rather than read here, so this module stays free of
 * any dependency on the store — which depends on it.
 */
export function publicStatus(storage: StorageStatus): PublicRuntimeStatus {
  const c = getConfig();
  return {
    mode: c.mode,
    transport: c.testTransport ? "stub" : "claude",
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
