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
 * note publishes no official write API, so this is the session cookie from the
 * CEO's own browser. `publishMode` decides what approval actually does:
 * "publish" puts the article live, "draft_only" leaves it as a note draft for
 * the CEO to publish by hand — the lower-exposure setting.
 */
export interface NoteConfig {
  configured: boolean;
  authToken: string;
  session: string;
  publishMode: "publish" | "draft_only";
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

function noteConfig(): NoteConfig {
  const authToken = str(process.env.NOTE_AUTH_TOKEN);
  return {
    configured: Boolean(authToken),
    authToken,
    session: str(process.env.NOTE_SESSION),
    publishMode: str(process.env.NOTE_PUBLISH_MODE) === "draft_only" ? "draft_only" : "publish",
  };
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
    dataDir: process.env.FRIDAY_DATA_DIR?.trim() || ".friday",
    google: googleConfig(),
    note: noteConfig(),
    webTools: bool(process.env.FRIDAY_WEB_TOOLS, true),
    codeExecution: bool(process.env.FRIDAY_CODE_EXECUTION, true),
  };
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
  /** What approving a note article does. Shown so the CEO is never surprised. */
  notePublishMode: NoteConfig["publishMode"];
}

export function publicStatus(): PublicRuntimeStatus {
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
    integrations: { google: c.google.configured, note: c.note.configured },
    notePublishMode: c.note.publishMode,
  };
}
