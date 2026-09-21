import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { AGENTS, AGENTS_BY_ID } from "@/lib/company/agents";
import { DEPARTMENTS } from "@/lib/company/departments";
import { PROJECTS, PROJECTS_BY_ID } from "@/lib/company/projects";
import { KNOWLEDGE } from "@/lib/company/knowledge";
import { COMPANY_KPIS, DEPARTMENT_LOAD, REVENUE_6M, THROUGHPUT_14D } from "@/lib/company/analytics";
import { isActiveStatus } from "@/lib/status";
import type { ActivityEvent, Priority, Task } from "@/lib/types";
import { mutate } from "@/server/runtime/store";

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

export function companyToolsFor(options: {
  canDelegate: boolean;
  canReport: boolean;
}): Anthropic.Tool[] {
  const tools = [...COMPANY_TOOLS, APPROVAL_TOOL];
  if (options.canDelegate) tools.push(DELEGATE_TOOL);
  if (options.canReport) tools.push(REPORT_TOOL);
  return tools;
}

export const COMPANY_TOOL_NAMES = new Set([
  ...COMPANY_TOOLS.map((t) => t.name),
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
        const approvalId = uid("ap");
        const title = String(input.title ?? "承認事項");
        mutate((s) => {
          s.approvals = [
            {
              id: approvalId,
              kind: (input.kind as never) ?? "decision",
              title,
              description: String(input.summary ?? ""),
              requestedBy: ctx.agentId,
              requestedAt: now,
              summary: String(input.summary ?? ""),
              impact: String(input.impact ?? ""),
              risk: (input.risk as never) ?? "medium",
              priority: (input.priority as Priority) ?? "high",
              status: "pending",
              href: "/command",
            },
            ...s.approvals,
          ];
          s.notifications = [
            {
              id: uid("ntf"),
              kind: "approval",
              level: input.priority === "urgent" ? "URGENT" : "APPROVAL_REQUIRED",
              title,
              message: `${roleOf(ctx.agentId)} があなたの承認を待っています。${input.summary ?? ""}`,
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
              message: `${title}の承認を申請`,
              detail: String(input.summary ?? ""),
              severity: input.priority === "urgent" ? "critical" : "important",
            },
            ...s.activity,
          ];
          const runtime = s.agents[ctx.agentId];
          if (runtime) {
            runtime.status = "needs_approval";
            runtime.currentTask = title;
            runtime.lastActiveAt = now;
          }
        });
        ctx.pendingApprovalId = approvalId;
        return {
          content:
            "CEOへ承認を申請しました。決定が出るまでこの作業は停止します。承認なしに実行してはいけません。",
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
