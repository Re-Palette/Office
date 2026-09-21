import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { AGENTS, AGENTS_BY_ID } from "@/lib/company/agents";
import { DEPARTMENTS } from "@/lib/company/departments";
import { PROJECTS, PROJECTS_BY_ID } from "@/lib/company/projects";
import { KNOWLEDGE } from "@/lib/company/knowledge";
import { COMPANY_KPIS, DEPARTMENT_LOAD, REVENUE_6M, THROUGHPUT_14D } from "@/lib/company/analytics";
import { isActiveStatus } from "@/lib/status";
import type { ActivityEvent, Approval, Priority, Task } from "@/lib/types";
import { getConfig } from "@/server/runtime/config";
import { mutate } from "@/server/runtime/store";
import {
  GoogleApiError,
  GoogleAuthError,
  googleClient,
  googleReady,
  type SendEmailInput,
} from "@/server/integrations/google";
import {
  markdownToNoteHtml,
  NoteApiError,
  NoteAuthError,
  noteClient,
} from "@/server/integrations/note";

/**
 * The tools AI employees actually use.
 *
 * Two kinds sit side by side: Anthropic-hosted server tools (web search, web
 * fetch, code execution) that give employees real reach, and the company tools
 * below, which this server executes against real company state. Every one of
 * them has a visible consequence in the dashboard.
 */

export interface RunContext {
  runId: string;
  agentId: string;
  depth: number;
  /** Set by the runner when a tool asks for the CEO. Halts the loop. */
  pendingApprovalId?: string;
  /**
   * An irreversible action the employee asked to perform, held back until the
   * CEO approves. The server, not the model, carries it out on resumption.
   */
  pendingAction?: PendingAction;
  /** Queued delegations the runner executes after the turn. */
  delegations: { agentId: string; objective: string; toolUseId: string }[];
  /** Report the run produced, if any. */
  reportId?: string;
}

let seq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const roleOf = (id: string) => AGENTS_BY_ID[id]?.role ?? id;

export function pushActivity(event: Omit<ActivityEvent, "id">): ActivityEvent {
  const full: ActivityEvent = { ...event, id: uid("act") };
  mutate((s) => {
    s.activity = [full, ...s.activity];
  });
  return full;
}

/* ── Tool definitions ─────────────────────────────────────────────────────── */

const COMPANY_TOOLS: Anthropic.Tool[] = [
  {
    name: "log_progress",
    description:
      "Record what you are doing right now so the CEO can see it in the live activity feed. Call this when you start a piece of work and whenever you reach a meaningful milestone. Keep it to one short sentence in Japanese.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "何をしているか（日本語・1文）" },
        detail: { type: "string", description: "補足（任意）" },
      },
      required: ["message"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_company_data",
    description:
      "Read the company's current state: tasks, projects, departments, AI employees, or analytics. Use this before making any claim about the company — never guess at numbers.",
    input_schema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["tasks", "projects", "departments", "employees", "analytics", "overview"],
        },
        filter: {
          type: "string",
          description:
            "Optional narrowing: a department id, a project id, or a task status such as RUNNING.",
        },
      },
      required: ["scope"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "search_knowledge",
    description:
      "Search the company's Knowledge Center — brand guidelines, CEO instructions, past reports, research and company memory. Use this before researching externally; the answer is often already ours.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "検索語" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "save_knowledge",
    description:
      "Write a durable finding into the company's knowledge base so other AI employees can use it later. Only save things worth remembering beyond this task.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string", description: "本文（日本語）" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["title", "content", "tags"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "create_task",
    description:
      "Create a real task on the company board. Use this for work that must be tracked, not for your own scratch notes.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        assignedAgent: { type: "string", description: "担当AI社員のid" },
        priority: { type: "string", enum: ["critical", "high", "normal", "low"] },
        projectId: { type: "string", description: "関連プロジェクトid（任意）" },
      },
      required: ["title", "description", "assignedAgent", "priority"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "complete_task",
    description: "Mark a task you own as completed, recording what the outcome was.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        output: { type: "string", description: "成果の要約（日本語）" },
      },
      required: ["taskId", "output"],
      additionalProperties: false,
    },
    strict: true,
  },
];

const DELEGATE_TOOL: Anthropic.Tool = {
  name: "delegate",
  description:
    "Hand a piece of work to another AI employee and get their result back. Use this for anything outside your own remit — you are running a company, not doing every job yourself. Give them a complete, self-contained objective; they cannot see your conversation.",
  input_schema: {
    type: "object",
    properties: {
      agentId: {
        type: "string",
        description: "委譲先のAI社員id（list は get_company_data の employees で取得）",
      },
      objective: {
        type: "string",
        description: "その社員が単独で理解できる、完結した指示（日本語）",
      },
    },
    required: ["agentId", "objective"],
    additionalProperties: false,
  },
  strict: true,
};

const APPROVAL_TOOL: Anthropic.Tool = {
  name: "request_ceo_approval",
  description:
    "Stop and ask the CEO. You MUST call this instead of acting whenever the work would send an external email, publish to social media, spend money, sign or commit to anything, deploy to production, or connect an external service. Your run pauses here until the CEO decides — that is correct and expected. Never work around this by doing the action yourself.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "承認事項（日本語・簡潔に）" },
      summary: { type: "string", description: "何をしようとしているか" },
      impact: {
        type: "string",
        description: "承認された瞬間に何が起きるか。取り消せないなら明記する。",
      },
      risk: { type: "string", enum: ["low", "medium", "high"] },
      priority: { type: "string", enum: ["urgent", "high", "medium", "low"] },
      kind: {
        type: "string",
        enum: ["email", "social_post", "deploy", "budget", "external_service", "contract", "decision"],
      },
    },
    required: ["title", "summary", "impact", "risk", "priority", "kind"],
    additionalProperties: false,
  },
  strict: true,
};

const REPORT_TOOL: Anthropic.Tool = {
  name: "submit_report",
  description:
    "Submit a finished report to the CEO. It is rendered as a PDF and enters the CEO's review queue. Every claim must come from data you actually read via your tools — no invented numbers. Write all prose in Japanese.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      type: {
        type: "string",
        enum: ["daily", "weekly", "project", "department", "research", "task_completion", "executive"],
      },
      executiveSummary: {
        type: "string",
        description: "結論から書く。300字程度。",
      },
      keyMetrics: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "string" },
            delta: { type: "string" },
          },
          required: ["label", "value"],
          additionalProperties: false,
        },
      },
      findings: { type: "array", items: { type: "string" } },
      risks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            level: { type: "string", enum: ["high", "medium", "low"] },
            text: { type: "string" },
          },
          required: ["level", "text"],
          additionalProperties: false,
        },
      },
      decisions: {
        type: "array",
        items: { type: "string" },
        description: "CEOに判断を求める事項。無ければ空配列。",
      },
      nextActions: { type: "array", items: { type: "string" } },
      projectId: { type: "string" },
      departmentId: { type: "string" },
    },
    required: [
      "title",
      "type",
      "executiveSummary",
      "keyMetrics",
      "findings",
      "risks",
      "decisions",
      "nextActions",
    ],
    additionalProperties: false,
  },
  strict: true,
};

/* ── Gmail and Calendar ───────────────────────────────────────────────────── */

/**
 * These four are the first tools that reach outside the company. Two of them
 * read, and run freely. Two of them are seen by real people and cannot be
 * taken back, so they do not execute when the model calls them: they queue,
 * raise an approval carrying the exact content, and stop the run. The server
 * performs the action after the CEO approves — the model never holds the
 * trigger, which is why no prompt wording can talk its way past this.
 */
const EMAIL_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_email",
    description:
      "Search the company inbox and read what came in. Use Gmail search syntax: `from:`, `subject:`, `is:unread`, `newer_than:3d`, `has:attachment`. Always check the inbox before claiming nobody replied, and before writing a follow-up. Returns headers and a snippet, not full bodies.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Gmail検索クエリ。例: "is:unread newer_than:7d", "from:client@example.com"',
        },
        limit: { type: "integer", description: "最大件数（1-25、既定10）" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "send_email",
    description:
      "Send an email from the company address. Write the complete, final text — this is not a draft for a human to finish. Calling this does NOT send: it puts the exact message in front of the CEO and pauses your run. The CEO approves, and only then does it go out. So write it as if it will be sent verbatim, because it will be. Never call request_ceo_approval separately for an email; this tool is the request.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "array", items: { type: "string" }, description: "宛先アドレス" },
        subject: { type: "string", description: "件名" },
        body: { type: "string", description: "本文。完成した文面をそのまま書く。" },
        cc: { type: "array", items: { type: "string" } },
        inReplyToMessageId: {
          type: "string",
          description: "返信するとき、read_email が返したメッセージid。スレッドが保たれる。",
        },
        reason: {
          type: "string",
          description: "CEOがこの送信を判断するための背景（日本語・1〜2文）",
        },
      },
      required: ["to", "subject", "body", "reason"],
      additionalProperties: false,
    },
    strict: true,
  },
];

const CALENDAR_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_calendar_events",
    description:
      "Read the CEO's calendar for a date range. Use this before proposing any time — never assume a slot is free.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "開始日時（RFC3339。例 2026-09-22T00:00:00+09:00）" },
        to: { type: "string", description: "終了日時（RFC3339）" },
        limit: { type: "integer", description: "最大件数（1-50、既定20）" },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "create_calendar_event",
    description:
      "Put an event on the CEO's calendar. Check availability with list_calendar_events first. Without attendees it is a private block and is created immediately. With attendees, Google emails an invitation to those real people, so it goes to the CEO for approval first and your run pauses.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "予定のタイトル" },
        start: { type: "string", description: "開始日時（RFC3339、タイムゾーン付き）" },
        end: { type: "string", description: "終了日時（RFC3339、タイムゾーン付き）" },
        description: { type: "string" },
        location: { type: "string", description: "場所、またはビデオ会議のURL" },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "招待する相手のアドレス。指定するとCEO承認が必要になる。",
        },
      },
      required: ["summary", "start", "end"],
      additionalProperties: false,
    },
    strict: true,
  },
];

/**
 * note has no official write API, so by default nothing here reaches note at
 * all: the article becomes a Markdown document the CEO reads and posts. That
 * is the whole delivery path, and it cannot break when note changes.
 *
 * With NOTE_OUTPUT set, the same tool instead goes through note's own internal
 * endpoints — a private draft first, then the CEO's approval to publish.
 * Either way the employee writes the article and stops there.
 */
const NOTE_TOOLS: Anthropic.Tool[] = [
  {
    name: "write_note_article",
    description:
      "Write a finished article for the company's note. This does NOT post it — it saves the article as a document for the CEO, who posts it. Write the complete piece, not an outline: Markdown headings, paragraphs, lists and links. Check the brand voice and what has already been published with search_knowledge first, and do not repeat an article that exists.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "記事タイトル。note で一覧に出る一行。" },
        body: {
          type: "string",
          description: "本文（Markdown）。完成原稿をそのまま書く。見出しは ## から。",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "ハッシュタグ（#は不要）。3〜5個。",
        },
        reason: {
          type: "string",
          description: "CEOがこの公開を判断するための背景（日本語・1〜2文）",
        },
      },
      required: ["title", "body", "tags", "reason"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export function companyToolsFor(options: {
  agentId: string;
  canDelegate: boolean;
  canReport: boolean;
}): Anthropic.Tool[] {
  const tools = [...COMPANY_TOOLS, APPROVAL_TOOL];
  if (options.canDelegate) tools.push(DELEGATE_TOOL);
  if (options.canReport) tools.push(REPORT_TOOL);

  // An employee is handed an integration only if the registry says that is
  // part of their job — the same list the org chart and Settings render from.
  const equipped = AGENTS_BY_ID[options.agentId]?.tools ?? [];
  if (googleReady()) {
    if (equipped.includes("email")) tools.push(...EMAIL_TOOLS);
    if (equipped.includes("calendar")) tools.push(...CALENDAR_TOOLS);
  }
  if (equipped.includes("note")) tools.push(...NOTE_TOOLS);

  return tools;
}

export const COMPANY_TOOL_NAMES = new Set([
  ...COMPANY_TOOLS.map((t) => t.name),
  ...EMAIL_TOOLS.map((t) => t.name),
  ...CALENDAR_TOOLS.map((t) => t.name),
  ...NOTE_TOOLS.map((t) => t.name),
  DELEGATE_TOOL.name,
  APPROVAL_TOOL.name,
  REPORT_TOOL.name,
]);

/* ── Execution ────────────────────────────────────────────────────────────── */

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  /** Set when the tool halts the run pending a CEO decision. */
  halt?: boolean;
}

/**
 * An irreversible action the employee asked for, parked until the CEO decides.
 * It is stored on the run, not in the conversation, so nothing the model says
 * afterwards can alter what actually gets performed.
 */
export interface PendingAction {
  tool: "send_email" | "create_calendar_event" | "publish_note_article";
  input: Record<string, unknown>;
  approvalId: string;
}

interface ApprovalRequest {
  kind: Approval["kind"];
  title: string;
  summary: string;
  impact: string;
  risk: Approval["risk"];
  priority: Priority;
  /** Shown to the CEO verbatim — the actual content being approved. */
  payload?: { label: string; value: string }[];
}

/** Raises the approval, notifies the CEO, and marks the employee as blocked. */
function raiseApproval(ctx: RunContext, request: ApprovalRequest, now: number): string {
  const approvalId = uid("ap");

  mutate((s) => {
    s.approvals = [
      {
        id: approvalId,
        kind: request.kind,
        title: request.title,
        description: request.summary,
        requestedBy: ctx.agentId,
        requestedAt: now,
        summary: request.summary,
        impact: request.impact,
        risk: request.risk,
        priority: request.priority,
        payload: request.payload,
        status: "pending",
        href: "/command",
      },
      ...s.approvals,
    ];
    s.notifications = [
      {
        id: uid("ntf"),
        kind: "approval",
        level: request.priority === "urgent" ? "URGENT" : "APPROVAL_REQUIRED",
        title: request.title,
        message: `${roleOf(ctx.agentId)} があなたの承認を待っています。${request.summary}`,
        createdAt: now,
        read: false,
        recipient: "CEO",
        agentId: ctx.agentId,
        relatedApprovalId: approvalId,
        href: "/command",
        actionLabel: "Review",
      },
      ...s.notifications,
    ];
    s.activity = [
      {
        id: uid("act"),
        kind: "approval.requested",
        agentId: ctx.agentId,
        at: now,
        message: `${request.title}の承認を申請`,
        detail: request.summary,
        severity: request.priority === "urgent" ? "critical" : "important",
      },
      ...s.activity,
    ];
    const runtime = s.agents[ctx.agentId];
    if (runtime) {
      runtime.status = "needs_approval";
      runtime.currentTask = request.title;
      runtime.lastActiveAt = now;
    }
  });

  ctx.pendingApprovalId = approvalId;
  return approvalId;
}

function noteFailure(error: unknown): ToolOutcome {
  if (error instanceof NoteAuthError) return { content: error.message, isError: true };
  if (error instanceof NoteApiError) {
    return { content: `note API エラー (${error.status}): ${error.message}`, isError: true };
  }
  return { content: `noteへの接続に失敗しました: ${(error as Error).message}`, isError: true };
}

function googleFailure(error: unknown): ToolOutcome {
  if (error instanceof GoogleAuthError) {
    return { content: `${error.message}`, isError: true };
  }
  if (error instanceof GoogleApiError) {
    return { content: `Google API エラー (${error.status}): ${error.message}`, isError: true };
  }
  return { content: `Google連携に失敗しました: ${(error as Error).message}`, isError: true };
}

const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : [];

export async function executeCompanyTool(
  name: string,
  rawInput: unknown,
  ctx: RunContext,
  toolUseId: string,
): Promise<ToolOutcome> {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const now = Date.now();

  try {
    switch (name) {
      case "log_progress": {
        const message = String(input.message ?? "").trim();
        if (!message) return { content: "message is required", isError: true };
        pushActivity({
          kind: "agent.thinking",
          agentId: ctx.agentId,
          at: now,
          message,
          detail: input.detail ? String(input.detail) : undefined,
        });
        return { content: "記録しました。" };
      }

      case "get_company_data":
        return { content: companyData(String(input.scope), input.filter ? String(input.filter) : undefined) };

      case "search_knowledge": {
        const q = String(input.query ?? "").toLowerCase();
        const hits = KNOWLEDGE.filter((d) =>
          `${d.title} ${d.excerpt} ${d.tags.join(" ")}`.toLowerCase().includes(q),
        ).slice(0, 8);
        pushActivity({
          kind: "agent.tool_called",
          agentId: ctx.agentId,
          at: now,
          message: "社内ナレッジを検索",
          detail: `"${input.query}" — ${hits.length}件`,
        });
        if (hits.length === 0) return { content: "該当なし。外部調査が必要です。" };
        return {
          content: hits
            .map((d) => `## ${d.title}\ncategory: ${d.category} / owner: ${roleOf(d.owner)}\n${d.excerpt}`)
            .join("\n\n"),
        };
      }

      case "save_knowledge": {
        const title = String(input.title ?? "").trim();
        if (!title) return { content: "title is required", isError: true };
        mutate((s) => {
          s.activity = [
            {
              id: uid("act"),
              kind: "insight.found",
              agentId: ctx.agentId,
              at: now,
              message: `ナレッジを保存: ${title}`,
              detail: String(input.content ?? "").slice(0, 160),
              severity: "important",
            },
            ...s.activity,
          ];
        });
        return { content: `Knowledge Center へ保存しました: ${title}` };
      }

      case "create_task": {
        const assignee = String(input.assignedAgent ?? "");
        const agent = AGENTS_BY_ID[assignee];
        if (!agent) {
          return {
            content: `Unknown agentId "${assignee}". get_company_data(scope:"employees") で有効なidを確認してください。`,
            isError: true,
          };
        }
        const task: Task = {
          id: uid("t"),
          title: String(input.title ?? "").slice(0, 120),
          description: String(input.description ?? ""),
          status: "RUNNING",
          priority: (String(input.priority ?? "normal") as Priority) === "urgent"
            ? "critical"
            : (input.priority as Task["priority"]) ?? "normal",
          assignedAgent: assignee,
          department: agent.department,
          project: input.projectId ? String(input.projectId) : undefined,
          createdAt: now,
          updatedAt: now,
          subTasks: [],
          progress: 5,
        };
        mutate((s) => {
          s.tasks = [task, ...s.tasks];
          s.activity = [
            {
              id: uid("act"),
              kind: "task.assigned",
              agentId: ctx.agentId,
              at: now,
              message: "タスクを作成し割り当て",
              detail: task.title,
              targetAgentId: assignee,
              taskId: task.id,
            },
            ...s.activity,
          ];
        });
        return { content: `タスクを作成しました（id: ${task.id}, 担当: ${agent.role}）。` };
      }

      case "complete_task": {
        const taskId = String(input.taskId ?? "");
        const found = mutate((s) => {
          const task = s.tasks.find((t) => t.id === taskId);
          if (!task) return false;
          task.status = "COMPLETED";
          task.progress = 100;
          task.updatedAt = now;
          task.output = String(input.output ?? "");
          s.activity = [
            {
              id: uid("act"),
              kind: "task.completed",
              agentId: ctx.agentId,
              at: now,
              message: "タスクを完了",
              detail: task.title,
              taskId: task.id,
            },
            ...s.activity,
          ];
          const runtime = s.agents[ctx.agentId];
          if (runtime) runtime.tasksCompleted += 1;
          return true;
        });
        return found
          ? { content: "完了として記録しました。" }
          : { content: `Unknown taskId "${taskId}".`, isError: true };
      }

      case "delegate": {
        const target = String(input.agentId ?? "");
        const agent = AGENTS_BY_ID[target];
        if (!agent) {
          return {
            content: `Unknown agentId "${target}". get_company_data(scope:"employees") を使ってください。`,
            isError: true,
          };
        }
        if (target === ctx.agentId) {
          return { content: "自分自身へは委譲できません。", isError: true };
        }
        ctx.delegations.push({
          agentId: target,
          objective: String(input.objective ?? ""),
          toolUseId,
        });
        // The runner fills in the real result after this turn.
        return { content: "__DELEGATION_PENDING__" };
      }

      case "request_ceo_approval": {
        raiseApproval(
          ctx,
          {
            kind: (input.kind as Approval["kind"]) ?? "decision",
            title: String(input.title ?? "承認事項"),
            summary: String(input.summary ?? ""),
            impact: String(input.impact ?? ""),
            risk: (input.risk as Approval["risk"]) ?? "medium",
            priority: (input.priority as Priority) ?? "high",
          },
          now,
        );
        return {
          content:
            "CEOへ承認を申請しました。決定が出るまでこの作業は停止します。承認なしに実行してはいけません。",
          halt: true,
        };
      }

      case "read_email": {
        const query = String(input.query ?? "").trim();
        if (!query) return { content: "query is required", isError: true };
        const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 25);

        try {
          const messages = await googleClient().searchEmail(query, limit);
          pushActivity({
            kind: "agent.tool_called",
            agentId: ctx.agentId,
            at: now,
            message: "受信メールを確認",
            detail: `"${query}" — ${messages.length}件`,
          });
          if (messages.length === 0) {
            return { content: `該当するメールはありません（query: ${query}）。` };
          }
          return {
            content: messages
              .map(
                (m) =>
                  `id: ${m.id}${m.unread ? " [未読]" : ""}\nfrom: ${m.from}\ndate: ${m.date}\nsubject: ${m.subject}\n${m.snippet}`,
              )
              .join("\n\n---\n\n"),
          };
        } catch (error) {
          return googleFailure(error);
        }
      }

      case "send_email": {
        const to = asList(input.to);
        const subject = String(input.subject ?? "").trim();
        const body = String(input.body ?? "").trim();
        if (to.length === 0) return { content: "to is required", isError: true };
        if (!subject || !body) {
          return { content: "subject と body は必須です。完成した文面を書いてください。", isError: true };
        }

        const cc = asList(input.cc);
        const approvalId = raiseApproval(
          ctx,
          {
            kind: "email",
            title: `メール送信: ${subject}`,
            summary: String(input.reason ?? "") || `${to.join(", ")} へメールを送信します。`,
            impact: `承認すると、この文面がそのまま ${to.join(", ")}${
              cc.length ? `（Cc: ${cc.join(", ")}）` : ""
            } へ送信されます。送信後の取り消しはできません。`,
            risk: "high",
            priority: "urgent",
            // The CEO approves the actual text, not a description of it.
            payload: [
              { label: "To", value: to.join(", ") },
              ...(cc.length ? [{ label: "Cc", value: cc.join(", ") }] : []),
              { label: "Subject", value: subject },
              { label: "Body", value: body },
            ],
          },
          now,
        );

        ctx.pendingAction = {
          tool: "send_email",
          input: { to, subject, body, cc, inReplyToMessageId: input.inReplyToMessageId },
          approvalId,
        };

        return {
          content:
            "メールはまだ送信していません。文面をそのままCEOの承認待ちに入れ、この作業を停止しました。" +
            "承認されればサーバーが送信します。別の手段で送ろうとしてはいけません。",
          halt: true,
        };
      }

      case "write_note_article": {
        const title = String(input.title ?? "").trim();
        const body = String(input.body ?? "").trim();
        if (!title || !body) {
          return { content: "title と body は必須です。完成原稿を書いてください。", isError: true };
        }
        // Short enough to be an outline rather than an article.
        if (body.length < 200) {
          return {
            content: `本文が${body.length}文字しかありません。note に出す完成原稿を書いてください。`,
            isError: true,
          };
        }

        const tags = asList(input.tags).map((t) => t.replace(/^#/, ""));
        const rationale = String(input.reason ?? "").trim();
        const { output } = getConfig().note;

        // The default. Nothing leaves this machine, so there is nothing to
        // gate: the article becomes a document and waits for the CEO.
        if (output === "file") {
          const { saveDraft } = await import("../note-drafts");
          const saved = saveDraft({ title, body, tags, rationale, createdBy: ctx.agentId }, now);

          mutate((s) => {
            s.notifications = [
              {
                id: uid("ntf"),
                kind: "task_completed",
                level: "INFO",
                title: `note下書き: ${title}`,
                message: `${roleOf(ctx.agentId)} が記事を書きました。${rationale}`,
                createdAt: now,
                read: false,
                recipient: "CEO",
                agentId: ctx.agentId,
                href: `/note/${saved.id}`,
                actionLabel: "Read",
              },
              ...s.notifications,
            ];
            s.activity = [
              {
                id: uid("act"),
                kind: "agent.completed",
                agentId: ctx.agentId,
                at: now,
                message: "note記事の下書きを作成",
                detail: title,
                severity: "important",
              },
              ...s.activity,
            ];
          });

          return {
            content:
              `下書きを保存しました（${saved.file}）。Dashboard の NOTE DRAFTS から読めます。` +
              "note へ投稿するのはCEOです。自分で投稿しようとしないでください。",
          };
        }

        // Opted in to note's undocumented endpoints. A note draft is private,
        // so it is created now; the CEO approves what becomes public.
        const html = markdownToNoteHtml(body);
        let draft;
        try {
          draft = await noteClient().createDraft({ title, body: html, tags });
        } catch (error) {
          return noteFailure(error);
        }

        pushActivity({
          kind: "agent.tool_called",
          agentId: ctx.agentId,
          at: now,
          message: "note に下書きを保存",
          detail: title,
        });

        const approvalId = raiseApproval(
          ctx,
          {
            kind: "social_post",
            title: `note記事の公開: ${title}`,
            summary: rationale || `note に「${title}」を公開します。`,
            impact:
              output === "draft"
                ? `承認すると公開可能と記録されますが、公開操作はCEOが note 上で行います（NOTE_OUTPUT=draft）。下書き: ${draft.editUrl}`
                : `承認するとこの記事が note 上で公開され、誰でも読める状態になります。下書きでの確認: ${draft.editUrl}`,
            risk: "medium",
            priority: "high",
            payload: [
              { label: "Title", value: title },
              ...(tags.length ? [{ label: "Tags", value: tags.map((t) => `#${t}`).join(" ") }] : []),
              { label: "note draft", value: draft.editUrl },
              { label: "Body", value: body },
            ],
          },
          now,
        );

        if (output === "draft") {
          // Nothing is queued: the CEO publishes by hand on note.
          return {
            content:
              `note に下書きを保存しました（${draft.editUrl}）。公開はCEOが note 上で行います。` +
              "この作業はここで停止します。",
            halt: true,
          };
        }

        ctx.pendingAction = {
          tool: "publish_note_article",
          input: { id: draft.id, title, body: html, tags, editUrl: draft.editUrl },
          approvalId,
        };

        return {
          content:
            `まだ公開していません。note に下書きを保存し（${draft.editUrl}）、本文をCEOの承認待ちに入れて停止しました。` +
            "承認されればサーバーが公開します。別の手段で公開してはいけません。",
          halt: true,
        };
      }

      case "list_calendar_events": {
        const from = String(input.from ?? "").trim();
        const to = String(input.to ?? "").trim();
        if (!from || !to) return { content: "from と to は必須です（RFC3339）。", isError: true };
        const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);

        try {
          const events = await googleClient().listEvents(from, to, limit);
          pushActivity({
            kind: "agent.tool_called",
            agentId: ctx.agentId,
            at: now,
            message: "カレンダーを確認",
            detail: `${from.slice(0, 10)} 〜 ${to.slice(0, 10)} — ${events.length}件`,
          });
          if (events.length === 0) return { content: "この期間に予定はありません。" };
          return {
            content: events
              .map(
                (e) =>
                  `${e.start} 〜 ${e.end} | ${e.summary}${e.location ? ` @ ${e.location}` : ""}${
                    e.attendees.length ? ` | 参加者: ${e.attendees.join(", ")}` : ""
                  }`,
              )
              .join("\n"),
          };
        } catch (error) {
          return googleFailure(error);
        }
      }

      case "create_calendar_event": {
        const summary = String(input.summary ?? "").trim();
        const start = String(input.start ?? "").trim();
        const end = String(input.end ?? "").trim();
        if (!summary || !start || !end) {
          return { content: "summary / start / end は必須です。", isError: true };
        }
        const attendees = asList(input.attendees);
        const payload = {
          summary,
          start,
          end,
          description: input.description ? String(input.description) : undefined,
          location: input.location ? String(input.location) : undefined,
          attendees,
        };

        // A private block on the CEO's own calendar is reversible and nobody
        // else sees it. Inviting people emails them, so that needs approval.
        if (attendees.length === 0) {
          try {
            const event = await googleClient().createEvent(payload);
            pushActivity({
              kind: "agent.tool_called",
              agentId: ctx.agentId,
              at: now,
              message: "カレンダーに予定を追加",
              detail: `${event.summary} — ${event.start}`,
            });
            return { content: `予定を作成しました: ${event.summary}（${event.start} 〜 ${event.end}）` };
          } catch (error) {
            return googleFailure(error);
          }
        }

        const approvalId = raiseApproval(
          ctx,
          {
            kind: "external_service",
            title: `打ち合わせの設定: ${summary}`,
            summary:
              String(input.description ?? "") ||
              `${attendees.join(", ")} を招待して予定を作成します。`,
            impact: `承認すると予定が作成され、${attendees.join(", ")} へGoogleから招待メールが届きます。`,
            risk: "medium",
            priority: "high",
            payload: [
              { label: "Title", value: summary },
              { label: "When", value: `${start} 〜 ${end}` },
              ...(payload.location ? [{ label: "Where", value: payload.location }] : []),
              { label: "Attendees", value: attendees.join(", ") },
            ],
          },
          now,
        );

        ctx.pendingAction = { tool: "create_calendar_event", input: payload, approvalId };

        return {
          content:
            "招待を伴う予定のため、まだ作成していません。CEOの承認待ちに入れ、この作業を停止しました。",
          halt: true,
        };
      }

      case "submit_report": {
        const { submitReportFromAgent } = await import("./reports");
        const report = submitReportFromAgent(input, ctx.agentId, now);
        ctx.reportId = report.id;
        return {
          content: `レポートを提出しました（id: ${report.id}）。PDF: ${report.pdfUrl}。CEOの確認待ちです。`,
        };
      }

      default:
        return { content: `Unknown tool "${name}".`, isError: true };
    }
  } catch (error) {
    return { content: `Tool failed: ${(error as Error).message}`, isError: true };
  }
}

/* ── Performing what the CEO approved ─────────────────────────────────────── */

/**
 * Runs a queued action once, after approval, from the server.
 *
 * This is the other half of the gate. The model asked for the action and then
 * lost control of it: what runs here is the input recorded at request time,
 * which is also exactly what the CEO read before approving. The employee is
 * told the outcome and carries on from there.
 */
export async function performApprovedAction(
  action: PendingAction,
  agentId: string,
): Promise<{ ok: boolean; message: string }> {
  const now = Date.now();

  try {
    if (action.tool === "send_email") {
      const input = action.input as unknown as SendEmailInput;
      const sent = await googleClient().sendEmail({
        to: input.to,
        subject: input.subject,
        body: input.body,
        cc: input.cc?.length ? input.cc : undefined,
        inReplyToMessageId: input.inReplyToMessageId || undefined,
      });
      pushActivity({
        kind: "agent.tool_called",
        agentId,
        at: now,
        message: "CEO承認を受けてメールを送信",
        detail: `${sent.to.join(", ")} — ${sent.subject}`,
        severity: "important",
      });
      return {
        ok: true,
        message: `メールを送信しました。宛先: ${sent.to.join(", ")} / 件名: ${sent.subject}（messageId: ${sent.id}）`,
      };
    }

    if (action.tool === "publish_note_article") {
      const input = action.input as { id: string; title: string; body: string; tags: string[] };
      const published = await noteClient().publish(input.id, {
        title: input.title,
        body: input.body,
        tags: input.tags,
      });
      pushActivity({
        kind: "agent.tool_called",
        agentId,
        at: now,
        message: "CEO承認を受けて note に公開",
        detail: `${published.title} — ${published.url}`,
        severity: "important",
      });
      return { ok: true, message: `note に公開しました: ${published.title}\n${published.url}` };
    }

    const event = await googleClient().createEvent(
      action.input as unknown as Parameters<ReturnType<typeof googleClient>["createEvent"]>[0],
    );
    pushActivity({
      kind: "agent.tool_called",
      agentId,
      at: now,
      message: "CEO承認を受けて予定を作成",
      detail: `${event.summary} — ${event.start}`,
      severity: "important",
    });
    return {
      ok: true,
      message: `予定を作成し、招待を送信しました: ${event.summary}（${event.start} 〜 ${event.end}）`,
    };
  } catch (error) {
    const message =
      action.tool === "publish_note_article"
        ? // The draft survives a failed publish, so say where it is rather than
          // leaving the CEO to wonder whether the article was lost.
          `${noteFailure(error).content}（下書きは note に残っています: ${
            (action.input as { editUrl?: string }).editUrl ?? "note の下書き一覧"
          }）`
        : googleFailure(error).content;
    pushActivity({
      kind: "agent.completed",
      agentId,
      at: now,
      message: "承認後の実行に失敗しました",
      detail: message.slice(0, 140),
      severity: "critical",
    });
    return { ok: false, message };
  }
}

/* ── Company data reader ──────────────────────────────────────────────────── */

function companyData(scope: string, filter?: string): string {
  const state = readCurrent();

  switch (scope) {
    case "employees": {
      const list = filter
        ? AGENTS.filter((a) => a.department === filter)
        : AGENTS;
      return list
        .map((a) => {
          const rt = state.agents[a.id];
          return `${a.id} | ${a.role} | ${a.department} | ${rt?.status ?? a.status} | skills: ${a.skills.join(", ")}`;
        })
        .join("\n");
    }

    case "tasks": {
      const list = filter
        ? state.tasks.filter((t) => t.status === filter || t.department === filter || t.project === filter)
        : state.tasks;
      return list
        .slice(0, 60)
        .map(
          (t) =>
            `${t.id} | ${t.status} | ${t.priority} | ${roleOf(t.assignedAgent)} | ${t.title}${
              t.blockedReason ? ` | BLOCKED: ${t.blockedReason}` : ""
            }`,
        )
        .join("\n");
    }

    case "projects":
      return PROJECTS.map(
        (p) =>
          `${p.id} | ${p.name} | ${p.progress}% | ${p.health} | owner: ${roleOf(p.owner)} | 次: ${
            p.milestones.find((m) => !m.done)?.label ?? "—"
          }`,
      ).join("\n");

    case "departments":
      return DEPARTMENTS.map((d) => {
        const load = DEPARTMENT_LOAD.find((l) => l.department === d.id);
        return `${d.id} | ${d.name} | head: ${roleOf(d.headAgentId)} | 稼働率 ${load?.utilization ?? "?"}% | 完了 ${load?.completed ?? "?"}件`;
      }).join("\n");

    case "analytics":
      return [
        "## KPI",
        ...COMPANY_KPIS.map((k) => `${k.label}: ${k.value} (${k.delta})`),
        "",
        "## 直近14日のタスク完了数",
        THROUGHPUT_14D.map((d) => `${d.day}: 完了${d.completed} / 作成${d.created}`).join("\n"),
        "",
        "## 売上と費用（6ヶ月）",
        REVENUE_6M.map((r) => `${r.month}: 売上 ¥${r.revenue.toLocaleString()} / 費用 ¥${r.cost.toLocaleString()}`).join("\n"),
      ].join("\n");

    case "overview":
    default: {
      const active = AGENTS.filter((a) => isActiveStatus(state.agents[a.id]?.status ?? a.status));
      const open = state.tasks.filter((t) => t.status !== "COMPLETED" && t.status !== "FAILED");
      const blocked = state.tasks.filter((t) => t.status === "WAITING_FOR_CEO");
      const pending = state.approvals.filter((a) => a.status === "pending");
      return [
        `AI社員: ${AGENTS.length}名（稼働中 ${active.length}名）`,
        `タスク: 進行中 ${open.length}件 / CEO承認待ちで停止 ${blocked.length}件`,
        `CEO承認待ち: ${pending.length}件`,
        `プロジェクト: ${PROJECTS.length}件（${PROJECTS.filter((p) => p.health !== "on_track").map((p) => `${p.name}=${p.health}`).join(", ") || "全て順調"}）`,
        `レポート: ${state.reports.length}件（確認待ち ${state.reports.filter((r) => r.status === "PENDING_REVIEW").length}件）`,
      ].join("\n");
    }
  }
}

function readCurrent() {
  // Imported lazily to keep this module usable from the tool schema side.
  return mutate((s) => s);
}

export const PROJECT_IDS = PROJECTS.map((p) => p.id);
export const DEPARTMENT_IDS = DEPARTMENTS.map((d) => d.id);
export { PROJECTS_BY_ID };
