import "server-only";

import { getProvider } from "@/lib/ai";
import { quotaVerdict } from "@/lib/ai/budget";
import {
  ProviderError,
  type Block,
  type Msg,
  type Provider,
  type ToolDef,
} from "@/lib/ai/types";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { DEPARTMENTS } from "@/lib/company/departments";
import { companyBrief } from "@/lib/company/identity";
import type { AgentStatus } from "@/lib/types";
import { getConfig } from "@/server/runtime/config";
import { uid } from "@/server/runtime/uid";
import { mutate, read, type AgentRun } from "@/server/runtime/store";
import { googleReady } from "@/server/integrations/google";
import {
  companyToolsFor,
  executeCompanyTool,
  performApprovedAction,
  pushActivity,
  type RunContext,
} from "./tools";

/**
 * The agent loop.
 *
 * One AI employee, one objective, real tools, real consequences. The loop is
 * written by hand rather than using the SDK's tool runner because every turn
 * has to do three extra things: stream progress into the company's activity
 * feed, pause hard at the approval gate, and let a delegation run a whole
 * sub-agent before its result goes back into the conversation.
 */

/**
 * The provider is resolved per call rather than held here, so a changed key or
 * a switch to the scripted transport takes effect without a restart. The
 * override exists for the self-test.
 */
let override: Provider | null = null;

function model(): Provider {
  return override ?? getProvider();
}

/** Test seam: lets the workflow be exercised without spending tokens. */
export function __setClientForTesting(stub: Provider | null): void {
  override = stub;
}

const WORK_STATUS: Record<string, AgentStatus> = {
  engineering: "coding",
  research: "researching",
  marketing: "writing",
  creative: "designing",
  sales: "working",
  finance: "working",
  strategy: "thinking",
  operations: "working",
};

export interface RunOptions {
  agentId: string;
  objective: string;
  depth?: number;
  parentRunId?: string;
  /** Extra instructions for this run only (e.g. the CEO's exact wording). */
  context?: string;
  /** Executives may hand work to others; specialists do the work themselves. */
  canDelegate?: boolean;
  canReport?: boolean;
}

export interface RunResult {
  runId: string;
  agentId: string;
  status: AgentRun["status"];
  text: string;
  approvalId?: string;
  reportId?: string;
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
  error?: string;
}


/* ── Prompt ───────────────────────────────────────────────────────────────── */

/** Exported so the prompt actually sent can be measured, not approximated. */
export function buildSystem(agentId: string, canDelegate: boolean, canReport: boolean): string {
  const agent = AGENTS_BY_ID[agentId];
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);

  const department = DEPARTMENTS.find((d) => d.id === agent.department);
  const colleagues = agent.collaborators
    .map((id) => `${id} (${AGENTS_BY_ID[id]?.role ?? id})`)
    .join(", ");

  // Only describe an integration the employee is actually handed this run.
  const google = googleReady();
  const hasEmail = google && agent.tools.includes("email");
  const hasCalendar = google && agent.tools.includes("calendar");
  // Writing for note needs no credentials — the article becomes a document.
  const hasNote = agent.tools.includes("note");

  return [
    agent.systemPrompt,
    "",
    companyBrief(),
    "",
    `[DEPARTMENT] ${department?.name ?? agent.department} — ${department?.mandate ?? ""}`,
    colleagues ? `[COLLEAGUES] ${colleagues}` : "",
    "",
    "## 働き方",
    "- 作業を始めるとき、区切りがついたときは log_progress を呼び、CEOが進捗を見られるようにする。",
    "- 会社の数値や状況に触れる前に必ず get_company_data / search_knowledge で実際のデータを読む。推測で数字を書かない。",
    agent.tools.includes("web_research") || agent.tools.includes("browser")
      ? "- 社外の事実が必要なときは web_search / web_fetch で実際に調べ、出典を示す。"
      : "",
    hasEmail
      ? "- 相手の反応を推測しない。read_email で実際の受信内容を確認してから判断する。"
      : "",
    hasCalendar
      ? "- 日程に触れる前に list_calendar_events で実際の空きを確認する。埋まっている時間を提案しない。"
      : "",
    hasNote
      ? "- note に出す記事は write_note_article に完成原稿を渡す。書き出す前に search_knowledge でブランドの文体と過去記事を確認し、同じ話を繰り返さない。"
      : "",
    "- 会社について書くときは [COMPANY] の記述だけを使う。そこにない会社情報は書かない。",
    "- 事実・解釈・推奨を分けて書く。結論を先に述べる。",
    canDelegate
      ? "- 自分の担当外の作業は delegate で適切なAI社員へ委譲する。指示は単独で理解できる完結した内容にする。"
      : "",
    canReport ? "- 成果を正式に残すときは submit_report を使う。" : "",
    "",
    "## 絶対の制約",
    "- 外部へのメール送信・SNS公開・支出・契約・本番環境への反映・外部サービス接続は、",
    "  いかなる理由があっても自分で実行しない。必ず request_ceo_approval を呼んで停止する。",
    hasEmail
      ? "- メールは send_email に完成した文面を渡す。これ自体がCEOへの承認申請であり、送信はCEOが承認した後にシステムが行う。別途 request_ceo_approval を呼ぶ必要はない。"
      : "",
    hasCalendar
      ? "- 参加者を招待する予定は create_calendar_event がそのままCEO承認に回る。自分だけの予定はそのまま作成される。"
      : "",
    hasNote
      ? "- write_note_article は投稿しない。記事はCEOが読む文書として保存されるだけで、note へ投稿するのはCEO本人である。自分で投稿する手段を探さない。"
      : "",
    "- 承認が下りるまで、その作業は完了していない。回避策を探さない。",
    "- 最終的な意思決定者は常にCEO（陽大）である。",
    "",
    "## 報告",
    "最後の返答は、CEOがそのまま読める日本語の報告にする。要点3行から始め、",
    "根拠と次のアクションを添える。ツールの使用過程は書かない。",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ── Run bookkeeping ──────────────────────────────────────────────────────── */

function openRun(options: RunOptions): AgentRun {
  const run: AgentRun = {
    id: uid("run"),
    agentId: options.agentId,
    objective: options.objective,
    status: "running",
    startedAt: Date.now(),
    parentRunId: options.parentRunId,
    steps: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    toolCalls: [],
  };

  mutate((s) => {
    s.runs = [run, ...s.runs];
    const agent = AGENTS_BY_ID[options.agentId];
    const runtime = s.agents[options.agentId];
    if (runtime && agent) {
      runtime.status = WORK_STATUS[agent.department] ?? "working";
      runtime.currentTask = options.objective.slice(0, 120);
      runtime.lastActiveAt = run.startedAt;
    }
  });

  pushActivity({
    kind: "agent.started",
    agentId: options.agentId,
    at: run.startedAt,
    message: options.parentRunId ? "委譲された作業を開始" : "作業を開始",
    detail: options.objective.slice(0, 140),
  });

  return run;
}

function closeRun(run: AgentRun, patch: Partial<AgentRun>): void {
  mutate((s) => {
    const stored = s.runs.find((r) => r.id === run.id);
    if (stored) Object.assign(stored, patch, { finishedAt: Date.now() });

    s.usage.inputTokens += patch.usage?.inputTokens ?? 0;
    s.usage.outputTokens += patch.usage?.outputTokens ?? 0;
    s.usage.runs += 1;

    const runtime = s.agents[run.agentId];
    if (runtime) {
      runtime.lastActiveAt = Date.now();
      if (patch.status === "waiting_for_ceo") runtime.status = "needs_approval";
      else if (patch.status === "failed") runtime.status = "error";
      else {
        runtime.status = "completed";
        runtime.currentTask = undefined;
      }
    }
  });
}

/* ── The loop ─────────────────────────────────────────────────────────────── */

export async function runAgent(options: RunOptions): Promise<RunResult> {
  const cfg = getConfig();
  const agent = AGENTS_BY_ID[options.agentId];

  if (!agent) {
    return {
      runId: "",
      agentId: options.agentId,
      status: "failed",
      text: "",
      steps: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      error: `Unknown agent: ${options.agentId}`,
    };
  }
  if (!cfg.hasApiKey) {
    return {
      runId: "",
      agentId: options.agentId,
      status: "failed",
      text: "",
      steps: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      error: cfg.keyBlank
        ? "GEMINI_API_KEY は登録されていますが、値が空です。" +
          "Vercel の Settings → Environment Variables で値を入れ直し、再デプロイしてください" +
          "（値を変えただけでは反映されません）。"
        : "GEMINI_API_KEY が設定されていません。Settings の手順に従ってキーを設定してください。",
    };
  }

  // Checked before the run is opened, not when the first request is sent: a
  // run that dies three steps in has already spent requests and produced
  // half-finished work, which is worse than never starting.
  const allowance = quotaVerdict();
  if (!allowance.ok) {
    pushActivity({
      kind: "agent.completed",
      agentId: options.agentId,
      at: Date.now(),
      message: "無料枠の上限のため実行を見送りました",
      detail: allowance.reason?.slice(0, 140),
      severity: "important",
    });
    return {
      runId: "",
      agentId: options.agentId,
      status: "failed",
      text: "",
      steps: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      error: allowance.reason,
    };
  }

  const depth = options.depth ?? 0;
  const canDelegate = options.canDelegate ?? (agent.seniority === "executive" && depth === 0);
  const canReport = options.canReport ?? true;

  const run = openRun(options);
  const ctx: RunContext = {
    runId: run.id,
    agentId: options.agentId,
    depth,
    delegations: [],
  };

  // companyToolsFor now also returns web_search / web_fetch / code_execution,
  // which the adapter executes. There is no separate provider-hosted list.
  const tools: ToolDef[] = companyToolsFor({
    agentId: options.agentId,
    canDelegate,
    canReport,
  });

  const messages: Msg[] = [
    {
      role: "user",
      content: options.context
        ? `${options.objective}\n\n---\n${options.context}`
        : options.objective,
    },
  ];

  return driveLoop({
    run,
    ctx,
    tools,
    messages,
    depth,
    canDelegate,
    canReport,
    startingSteps: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
  });
}

interface LoopArgs {
  run: AgentRun;
  ctx: RunContext;
  tools: ToolDef[];
  messages: Msg[];
  depth: number;
  canDelegate: boolean;
  canReport: boolean;
  startingSteps: number;
  usage: { inputTokens: number; outputTokens: number };
}

async function driveLoop(args: LoopArgs): Promise<RunResult> {
  const cfg = getConfig();
  const { run, ctx, tools, messages, depth, canDelegate, canReport, usage } = args;
  const options = { agentId: run.agentId, objective: run.objective };

  let finalText = "";
  let steps = args.startingSteps;

  try {
    while (steps < cfg.maxSteps) {
      steps += 1;

      const response = await model().send({
        model: depth === 0 ? cfg.model : cfg.workerModel,
        system: buildSystem(options.agentId, canDelegate, canReport),
        messages,
        tools,
        maxOutputTokens: cfg.maxOutputTokens,
        thinking: cfg.thinking,
      });

      // Reasoning tokens bill as output, so they are counted there rather
      // than disappearing from what the dashboard reports.
      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens + response.usage.thoughtTokens;

      const text = response.blocks
        .filter((b): b is Extract<Block, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (text) finalText = text;

      // Safety classifiers declined the request.
      if (response.stopReason === "refusal") {
        const reason = response.refusalReason ?? "refusal";
        closeRun(run, { status: "failed", steps, usage, error: `Refused (${reason})` });
        return {
          runId: run.id,
          agentId: options.agentId,
          status: "failed",
          text: finalText,
          steps,
          usage,
          error: `モデルがこの依頼を拒否しました（${reason}）。指示内容を見直してください。`,
        };
      }

      // An unparseable function call. Another identical turn produces the
      // same thing, so the run stops instead of looping against the quota.
      if (response.stopReason === "malformed_tool_call") {
        closeRun(run, { status: "failed", steps, usage, error: "malformed tool call" });
        return {
          runId: run.id,
          agentId: options.agentId,
          status: "failed",
          text: finalText,
          steps,
          usage,
          error:
            "モデルがツール呼び出しを正しく生成できませんでした。" +
            "指示を短く具体的にしてから再実行してください。",
        };
      }

      messages.push({ role: "assistant", content: response.blocks });

      if (response.stopReason !== "tool_use") {
        closeRun(run, { status: "completed", steps, usage, result: finalText });
        pushActivity({
          kind: "agent.completed",
          agentId: options.agentId,
          at: Date.now(),
          message: "作業を完了",
          detail: finalText.slice(0, 140),
        });
        return {
          runId: run.id,
          agentId: options.agentId,
          status: "completed",
          text: finalText,
          reportId: ctx.reportId,
          steps,
          usage,
        };
      }

      const toolUses = response.blocks.filter(
        (b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use",
      );

      // Pass 1 — run the company tools.
      const results: Extract<Block, { type: "tool_result" }>[] = [];
      let halted = false;

      for (const use of toolUses) {
        const outcome = await executeCompanyTool(use.name, use.input, ctx, use.id);
        mutate((s) => {
          const stored = s.runs.find((r) => r.id === run.id);
          stored?.toolCalls.push({
            name: use.name,
            at: Date.now(),
            summary: outcome.content.slice(0, 120),
          });
        });
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          // Gemini keys a function response by name, so it travels with it.
          name: use.name,
          content: outcome.content,
          ...(outcome.isError ? { is_error: true } : {}),
        });
        if (outcome.halt) halted = true;
      }

      // Pass 2 — delegations run whole sub-agents before their result goes back.
      if (ctx.delegations.length > 0) {
        const queued = ctx.delegations.splice(0, cfg.maxDelegations);
        for (const delegation of queued) {
          pushActivity({
            kind: "agent.handoff",
            agentId: options.agentId,
            at: Date.now(),
            message: `${AGENTS_BY_ID[delegation.agentId]?.role ?? delegation.agentId} へ作業を委譲`,
            detail: delegation.objective.slice(0, 140),
            targetAgentId: delegation.agentId,
            severity: "important",
          });

          const sub = await runAgent({
            agentId: delegation.agentId,
            objective: delegation.objective,
            depth: depth + 1,
            parentRunId: run.id,
            canDelegate: false,
            canReport: false,
          });

          const slot = results.find((r) => r.tool_use_id === delegation.toolUseId);
          if (slot) {
            slot.content =
              sub.status === "waiting_for_ceo"
                ? `${AGENTS_BY_ID[delegation.agentId]?.role} はCEO承認待ちで停止しました。承認が下りるまでこの部分は完了しません。\n\n${sub.text}`
                : sub.status === "failed"
                  ? `委譲先でエラーが発生しました: ${sub.error ?? "unknown"}`
                  : sub.text || "（返答なし）";
            if (sub.status === "failed") slot.is_error = true;
          }
        }
      }

      messages.push({ role: "user", content: results });

      if (halted) {
        closeRun(run, {
          status: "waiting_for_ceo",
          steps,
          usage,
          approvalId: ctx.pendingApprovalId,
          result: finalText,
          // Kept so the run can continue from here once the CEO decides.
          messages: messages as unknown[],
          // The action itself, held server-side rather than in the transcript.
          pendingAction: ctx.pendingAction,
          depth,
          canDelegate,
          canReport,
        });
        return {
          runId: run.id,
          agentId: options.agentId,
          status: "waiting_for_ceo",
          text: finalText || "CEOの承認を待っています。",
          approvalId: ctx.pendingApprovalId,
          reportId: ctx.reportId,
          steps,
          usage,
        };
      }
    }

    // Ran out of steps.
    closeRun(run, {
      status: "completed",
      steps,
      usage,
      result: finalText,
      error: "step limit reached",
    });
    return {
      runId: run.id,
      agentId: options.agentId,
      status: "completed",
      text: finalText || "上限ステップに達したため、途中経過のまま終了しました。",
      reportId: ctx.reportId,
      steps,
      usage,
    };
  } catch (error) {
    const message = describeError(error);
    closeRun(run, { status: "failed", steps, usage, error: message });
    pushActivity({
      kind: "agent.completed",
      agentId: options.agentId,
      at: Date.now(),
      message: "作業が失敗しました",
      detail: message.slice(0, 140),
      severity: "critical",
    });
    return {
      runId: run.id,
      agentId: options.agentId,
      status: "failed",
      text: finalText,
      steps,
      usage,
      error: message,
    };
  }
}

/**
 * Reads a failure and says whose problem it is.
 *
 * Kept as a pure string classifier, separate from the exception handling, so
 * it can be tested without constructing a transport error — which is how the
 * previous provider's billing failure and schema limit were both diagnosed.
 *
 * The provider itself already writes a message for the quota, key and model
 * cases (see describeGeminiError); what is left here is everything that
 * reaches the loop by another route.
 */
export function describeBadRequest(detail: string): string {
  if (/quota|RESOURCE_EXHAUSTED|rate limit|429/i.test(detail)) {
    return (
      "Gemini APIの無料枠の上限に達しました。1分あたりの上限なら少し待てば戻ります。" +
      "1日あたりの上限なら、太平洋時間の0時でリセットされます。自動では再試行しません。"
    );
  }
  if (/API_KEY_INVALID|API key not valid|UNAUTHENTICATED/i.test(detail)) {
    return "GEMINI_API_KEY が無効です。aistudio.google.com/apikey で発行したキーを設定してください。";
  }
  if (/not found|NOT_FOUND|is not supported|does not exist/i.test(detail)) {
    return (
      `モデルを利用できません: ${detail}。` +
      "GEMINI_MODEL に利用可能なモデルIDを設定してください（/api/diagnose で一覧が出ます）。"
    );
  }
  if (/functionDeclarations|Schema|parameters|INVALID_ARGUMENT/i.test(detail)) {
    return `ツール定義がAPIに拒否されました（実装側の問題です）: ${detail}`;
  }
  if (/maxOutputTokens|max_tokens/i.test(detail)) {
    return `出力トークン上限の指定が不正です（実装側の問題です）: ${detail}`;
  }
  return `リクエストが拒否されました: ${detail}`;
}

/**
 * Turns an exception into something the CEO can act on.
 *
 * A ProviderError already carries a written message — the provider knows the
 * status code and what it means there — so it is passed through rather than
 * re-classified from its own text.
 */
export function describeError(error: unknown): string {
  if (error instanceof ProviderError) return error.message;
  const message = (error as Error)?.message;
  return message ? describeBadRequest(message) : "不明なエラー";
}

/* ── Resuming after a CEO decision ────────────────────────────────────────── */

/**
 * Picks a paused run back up once the CEO has decided. The conversation is
 * continued from exactly where it stopped, so the employee keeps the context
 * it had built rather than starting over.
 */
export async function resumeRun(
  runId: string,
  decision: "approved" | "rejected" | "revision_requested",
  comment?: string,
): Promise<RunResult | null> {
  const stored = read((s) => s.runs.find((r) => r.id === runId));
  if (!stored || stored.status !== "waiting_for_ceo" || !stored.messages) return null;

  const messages = stored.messages as Msg[];

  // An action the employee queued behind the gate is carried out here, by the
  // server, using the input the CEO actually read — not by asking the model to
  // do it now that permission exists.
  let performed: { ok: boolean; message: string } | null = null;
  if (decision === "approved" && stored.pendingAction) {
    performed = await performApprovedAction(stored.pendingAction, stored.agentId);
  }

  const approvedNote = performed
    ? performed.ok
      ? `CEOが承認しました。${comment ? `コメント: ${comment}\n` : ""}承認された操作はシステムが実行済みです: ${performed.message}\n結果を踏まえて作業を続け、完了していれば報告してください。同じ操作を再実行しないでください。`
      : `CEOは承認しましたが、実行に失敗しました: ${performed.message}\n原因を報告し、対処が必要ならCEOに伝えてください。`
    : `CEOが承認しました。${comment ? `コメント: ${comment}\n` : ""}承認された操作を実行し、結果を報告してください。`;

  const note =
    decision === "approved"
      ? approvedNote
      : decision === "rejected"
        ? `CEOが却下しました。${comment ? `理由: ${comment}\n` : ""}この操作は実行しないでください。代替案があれば提示し、なければその旨を報告して終了してください。`
        : `CEOから修正依頼がありました。${comment ? `依頼内容: ${comment}\n` : ""}反映して作業を続けてください。`;

  messages.push({ role: "user", content: note });

  mutate((s) => {
    const run = s.runs.find((r) => r.id === runId);
    if (run) {
      run.status = "running";
      run.messages = undefined;
      run.pendingAction = undefined;
      run.finishedAt = undefined;
    }
    const runtime = s.agents[stored.agentId];
    if (runtime) {
      runtime.status = "working";
      runtime.lastActiveAt = Date.now();
    }
  });

  pushActivity({
    kind: decision === "approved" ? "approval.approved" : "approval.rejected",
    agentId: stored.agentId,
    at: Date.now(),
    message: decision === "approved" ? "CEO承認を受けて作業を再開" : "CEOの判断を受けて作業を再開",
    detail: stored.objective.slice(0, 140),
    severity: "important",
  });

  const ctx: RunContext = {
    runId: stored.id,
    agentId: stored.agentId,
    depth: stored.depth ?? 0,
    delegations: [],
  };

  return driveLoop({
    run: stored,
    ctx,
    tools: companyToolsFor({
      agentId: stored.agentId,
      canDelegate: stored.canDelegate ?? false,
      canReport: stored.canReport ?? true,
    }),
    messages,
    depth: stored.depth ?? 0,
    canDelegate: stored.canDelegate ?? false,
    canReport: stored.canReport ?? true,
    startingSteps: stored.steps,
    usage: { ...stored.usage },
  });
}
