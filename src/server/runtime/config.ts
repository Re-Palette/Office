import "server-only";

/**
 * Runtime configuration for the live agent layer.
 *
 * Without an API key the app stays in demo mode: the mock simulator drives the
 * dashboard exactly as before. With a key, AI employees run for real — they
 * call Claude, use tools, and write their results back into the company state.
 */

export type RuntimeMode = "live" | "demo";

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
  };
}
