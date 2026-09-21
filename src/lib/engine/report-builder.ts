import { AGENTS_BY_ID } from "@/lib/company/agents";
import { DEPARTMENTS } from "@/lib/company/departments";
import { PROJECTS, PROJECTS_BY_ID } from "@/lib/company/projects";
import { COMPANY_KPIS, DEPARTMENT_LOAD } from "@/lib/company/analytics";
import { DEPARTMENT_TASK_DELTA, TASK_TOTALS } from "@/lib/company/tasks";
import { isActiveStatus } from "@/lib/status";
import { formatDate, formatDay } from "@/lib/time";
import type {
  ActivityEvent,
  Agent,
  DepartmentId,
  Report,
  ReportContent,
  ReportContribution,
  ReportDepartmentResult,
  ReportProjectResult,
  ReportRisk,
  ReportType,
  Task,
} from "@/lib/types";
import { REPORT_TYPE_LABEL } from "@/lib/types";

/**
 * Report generation.
 *
 * A report is never free-form prose: it aggregates the same tasks, activity,
 * projects, departments and analytics the dashboard already shows, then states
 * what it found. The on-screen Report Detail and the PDF both render from the
 * `ReportContent` this produces, so the two can never disagree.
 */

export interface ReportSnapshot {
  agents: Agent[];
  tasks: Task[];
  activity: ActivityEvent[];
  now: number;
}

export interface BuildReportOptions {
  type: ReportType;
  snapshot: ReportSnapshot;
  projectId?: string;
  departmentId?: DepartmentId;
  /** Carried into the re-issued report when the CEO asked for changes. */
  revisionNote?: string;
}

const AUTHOR_BY_TYPE: Record<ReportType, string> = {
  daily: "coo",
  weekly: "coo",
  executive: "coo",
  briefing: "chief_of_staff",
  project: "coo",
  department: "coo",
  research: "research_director",
  task_completion: "chief_of_staff",
};

/** Departments whose work is summarised for each report type. */
function scopeDepartments(opts: BuildReportOptions): DepartmentId[] {
  if (opts.departmentId) return [opts.departmentId];
  if (opts.projectId) return PROJECTS_BY_ID[opts.projectId]?.departments ?? [];
  if (opts.type === "research") return ["research"];
  return DEPARTMENTS.map((d) => d.id);
}

function departmentResults(
  departments: DepartmentId[],
  snap: ReportSnapshot,
): ReportDepartmentResult[] {
  return departments.map((id) => {
    const meta = DEPARTMENTS.find((d) => d.id === id)!;
    const members = snap.agents.filter((a) => a.department === id);
    const active = members.filter((a) => isActiveStatus(a.status));
    const tasks = snap.tasks.filter((t) => t.department === id);
    const done = tasks.filter((t) => t.status === "COMPLETED");
    const open = tasks.filter(
      (t) => t.status !== "COMPLETED" && t.status !== "FAILED",
    );
    const blocked = tasks.filter(
      (t) => t.status === "WAITING" || t.status === "WAITING_FOR_CEO",
    );
    const load = DEPARTMENT_LOAD.find((d) => d.department === id);

    const headline = blocked.length
      ? `${blocked.length}件が待機中。稼働は ${active.length}/${members.length} 名。`
      : open.length
        ? `${open.length}件が進行中。稼働は ${active.length}/${members.length} 名。`
        : `本日分の担当タスクはすべて完了。`;

    const points = [
      `完了 ${done.length + DEPARTMENT_TASK_DELTA[id]} 件 / 進行中 ${open.length} 件。`,
      ...(open[0]
        ? [`最優先は「${open[0].title}」（${roleOf(open[0].assignedAgent)} 担当）。`]
        : []),
      ...(blocked.length
        ? [`${blocked.length}件がCEOまたは他部署の判断を待っています。`]
        : []),
    ];

    return {
      department: id,
      headline,
      points,
      metric: load
        ? { label: "Utilization", value: `${load.utilization}%` }
        : undefined,
    };
  });
}

function projectResults(opts: BuildReportOptions): ReportProjectResult[] {
  const projects = opts.projectId
    ? PROJECTS.filter((p) => p.id === opts.projectId)
    : opts.departmentId
      ? PROJECTS.filter((p) => p.departments.includes(opts.departmentId!))
      : PROJECTS;

  return projects.map((p) => {
    const next = p.milestones.find((m) => !m.done);
    return {
      projectId: p.id,
      progress: p.progress,
      health: p.health,
      note: next
        ? `次のマイルストーンは「${next.label}」（${formatDay(next.due)}）。`
        : "すべてのマイルストーンが完了しています。",
    };
  });
}

function achievements(snap: ReportSnapshot): ReportContribution[] {
  const completed = snap.activity
    .filter((e) => e.kind === "agent.completed" || e.kind === "task.completed")
    .slice(0, 8);

  const seen = new Set<string>();
  const out: ReportContribution[] = [];
  for (const event of completed) {
    if (seen.has(event.agentId)) continue;
    seen.add(event.agentId);
    out.push({
      agentId: event.agentId,
      text: event.detail ? `${event.message} — ${event.detail}` : event.message,
    });
    if (out.length >= 6) break;
  }

  // Fall back to the task board when the stream has not produced enough yet.
  if (out.length < 3) {
    for (const task of snap.tasks.filter((t) => t.status === "COMPLETED")) {
      if (seen.has(task.assignedAgent)) continue;
      seen.add(task.assignedAgent);
      out.push({ agentId: task.assignedAgent, text: `${task.title}を完了。` });
      if (out.length >= 6) break;
    }
  }
  return out;
}

function findings(snap: ReportSnapshot): string[] {
  return snap.activity
    .filter((e) => e.kind === "insight.found")
    .slice(0, 6)
    .map((e) => `${roleOf(e.agentId)}: ${e.message}${e.detail ? `（${e.detail}）` : ""}`);
}

function risks(snap: ReportSnapshot): ReportRisk[] {
  const out: ReportRisk[] = [];

  for (const project of PROJECTS) {
    if (project.health === "blocked") {
      out.push({ level: "high", text: `${project.name} が停滞しています。進捗 ${project.progress}%。` });
    } else if (project.health === "at_risk") {
      out.push({ level: "medium", text: `${project.name} は要注意。進捗 ${project.progress}% で期限が近づいています。` });
    }
  }

  const blocked = snap.tasks.filter((t) => t.status === "WAITING_FOR_CEO");
  if (blocked.length > 0) {
    out.push({
      level: "high",
      text: `${blocked.length}件のタスクがCEO承認待ちで停止しています。`,
    });
  }

  const overloaded = DEPARTMENT_LOAD.filter((d) => d.utilization >= 88);
  for (const d of overloaded) {
    const name = DEPARTMENTS.find((x) => x.id === d.department)?.name ?? d.department;
    out.push({ level: "medium", text: `${name} の稼働率が ${d.utilization}% に達しています。` });
  }

  return out.slice(0, 5);
}

function decisions(snap: ReportSnapshot): string[] {
  const blocked = snap.tasks.filter((t) => t.status === "WAITING_FOR_CEO");
  const out = blocked.map(
    (t) => `${t.title} — ${t.blockedReason ?? "CEO承認が必要です"}（${roleOf(t.assignedAgent)}）`,
  );
  if (out.length === 0) {
    out.push("現時点でCEOの判断を要する事項はありません。");
  }
  return out;
}

function keyMetrics(snap: ReportSnapshot, type: ReportType) {
  const active = snap.agents.filter((a) => isActiveStatus(a.status)).length;
  const completed =
    snap.tasks.filter((t) => t.status === "COMPLETED").length + TASK_TOTALS.padding;
  const open = snap.tasks.filter(
    (t) => t.status !== "COMPLETED" && t.status !== "FAILED",
  ).length;
  const blocked = snap.tasks.filter((t) => t.status === "WAITING_FOR_CEO").length;

  const base = [
    { label: "Completed Tasks", value: String(completed), delta: "+6", positive: true },
    { label: "AI Employees Active", value: String(active), delta: "+2", positive: true },
    { label: "Tasks In Progress", value: String(open) },
    { label: "Projects Updated", value: String(PROJECTS.filter((p) => p.status === "active").length) },
    { label: "CEO Decisions Required", value: String(blocked) },
  ];

  if (type === "weekly" || type === "executive") {
    return [...base, ...COMPANY_KPIS.slice(0, 3).map((k) => ({
      label: k.label,
      value: k.value,
      delta: k.delta,
      positive: k.positive,
    }))];
  }
  return base;
}

function nextActions(snap: ReportSnapshot): string[] {
  const out: string[] = [];
  const blocked = snap.tasks.filter((t) => t.status === "WAITING_FOR_CEO");
  if (blocked.length) {
    out.push(`CEO承認が下り次第、${blocked.length}件の停止中タスクを即時再開する。`);
  }
  const atRisk = PROJECTS.filter((p) => p.health !== "on_track");
  for (const p of atRisk.slice(0, 2)) {
    out.push(`${p.name} の遅延要因を特定し、担当部署と回復計画を作る。`);
  }
  const running = snap.tasks.filter((t) => t.status === "RUNNING").slice(0, 2);
  for (const t of running) {
    out.push(`${t.title}を完了させる（${roleOf(t.assignedAgent)}）。`);
  }
  return out.slice(0, 5);
}

function roleOf(agentId: string): string {
  return AGENTS_BY_ID[agentId]?.role ?? agentId;
}

function summaryText(
  opts: BuildReportOptions,
  results: ReportDepartmentResult[],
  snap: ReportSnapshot,
): string {
  const completed =
    snap.tasks.filter((t) => t.status === "COMPLETED").length + TASK_TOTALS.padding;
  const active = snap.agents.filter((a) => isActiveStatus(a.status)).length;
  const blocked = snap.tasks.filter((t) => t.status === "WAITING_FOR_CEO").length;

  const busiest = [...results].sort(
    (a, b) => Number(b.metric?.value.replace("%", "") ?? 0) - Number(a.metric?.value.replace("%", "") ?? 0),
  )[0];
  const busiestName = busiest
    ? DEPARTMENTS.find((d) => d.id === busiest.department)?.name
    : undefined;

  const parts = [
    `本日、${active}名のAI社員が稼働し、${completed}件のタスクを完了しました。`,
    busiestName ? `最も負荷が高いのは ${busiestName} です。` : "",
    blocked > 0
      ? `CEOの判断を待って停止しているタスクが${blocked}件あります。これらが会社全体のクリティカルパス上にあります。`
      : "CEOの判断待ちで停止しているタスクはありません。",
    opts.revisionNote
      ? `本版はCEOからの修正依頼「${opts.revisionNote}」を反映して再作成したものです。`
      : "",
  ];
  return parts.filter(Boolean).join("");
}

export function buildReportContent(opts: BuildReportOptions): ReportContent {
  const { snapshot: snap, type } = opts;
  const departments = scopeDepartments(opts);
  const results = departmentResults(departments, snap);

  const scopeLabel = opts.projectId
    ? PROJECTS_BY_ID[opts.projectId]?.name
    : opts.departmentId
      ? DEPARTMENTS.find((d) => d.id === opts.departmentId)?.name
      : "全社";

  return {
    subtitle: `${scopeLabel} — ${REPORT_TYPE_LABEL[type]}`,
    period: formatDate(snap.now),
    executiveSummary: summaryText(opts, results, snap),
    keyMetrics: keyMetrics(snap, type),
    departmentResults: results,
    projectResults: projectResults(opts),
    achievements: achievements(snap),
    findings: findings(snap),
    risks: risks(snap),
    decisions: decisions(snap),
    nextActions: nextActions(snap),
    appendix: [
      { label: "Generated by", value: roleOf(AUTHOR_BY_TYPE[type]) },
      { label: "Data sources", value: "Tasks · Activity · Projects · Departments · Analytics" },
      { label: "AI employees on duty", value: `${snap.agents.filter((a) => isActiveStatus(a.status)).length} / ${snap.agents.length}` },
      { label: "Approval gate", value: "送信・公開・課金・本番反映はCEO承認を要します" },
    ],
  };
}

/** Everyone whose work is cited, so the report says where it came from. */
export function collectSources(content: ReportContent, author: string): string[] {
  const ids = new Set<string>([author]);
  content.achievements.forEach((a) => ids.add(a.agentId));
  content.departmentResults.forEach((d) => {
    const head = DEPARTMENTS.find((x) => x.id === d.department)?.headAgentId;
    if (head) ids.add(head);
  });
  return [...ids].slice(0, 10);
}

let reportCounter = 0;

export function buildReport(opts: BuildReportOptions & { now: number }): Report {
  const content = buildReportContent(opts);
  const author = AUTHOR_BY_TYPE[opts.type];
  const id = `rep-${opts.now.toString(36)}-${(reportCounter++).toString(36)}`;

  return {
    id,
    title: reportTitle(opts, content),
    type: opts.type,
    status: "PENDING_REVIEW",
    createdBy: author,
    sources: collectSources(content, author),
    createdAt: opts.now,
    updatedAt: opts.now,
    projectId: opts.projectId,
    departmentId: opts.departmentId,
    content,
    pdfUrl: `/reports/${id}/pdf`,
    requiresReview: true,
    priority: content.risks.some((r) => r.level === "high") ? "high" : "medium",
    version: 1,
  };
}

function reportTitle(opts: BuildReportOptions, content: ReportContent): string {
  const label = REPORT_TYPE_LABEL[opts.type];
  if (opts.projectId) return `${PROJECTS_BY_ID[opts.projectId]?.name} — ${label}`;
  if (opts.departmentId) {
    const name = DEPARTMENTS.find((d) => d.id === opts.departmentId)?.name;
    return `${name} — ${label}`;
  }
  return `${label} — ${content.period}`;
}

export { AUTHOR_BY_TYPE };
