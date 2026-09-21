"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useMemo } from "react";
import { motion } from "framer-motion";
import { Brain, KeyRound, Network, Wrench } from "lucide-react";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { getDepartment } from "@/lib/company/departments";
import { PROJECTS } from "@/lib/company/projects";
import { useCompany } from "@/lib/store";
import { AGENT_STATUS, PRIORITY_META, TASK_STATUS } from "@/lib/status";
import { formatRelative } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  Avatar,
  Chip,
  Panel,
  PanelHeader,
  Progress,
  StatusPill,
} from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/page-header";
import { ActivityFeed } from "@/components/company/activity-feed";

const PERMISSION_LABEL: Record<string, string> = {
  read_company_data: "社内データの閲覧",
  write_company_data: "社内データの更新",
  assign_tasks: "他のAI社員へのタスク割当",
  spend_budget: "予算の支出（CEO承認必須）",
  send_external_email: "外部メール送信（CEO承認必須）",
  publish_social: "SNS公開（CEO承認必須）",
  deploy_production: "本番Deploy（CEO承認必須）",
  connect_external_service: "外部サービス接続（CEO承認必須）",
};

const GATED = new Set([
  "spend_budget",
  "send_external_email",
  "publish_social",
  "deploy_production",
  "connect_external_service",
]);

export default function EmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const agents = useCompany((s) => s.agents);
  const tasks = useCompany((s) => s.tasks);
  const activity = useCompany((s) => s.activity);
  const now = useCompany((s) => s.now);

  const agent = agents.find((a) => a.id === id);

  const agentTasks = useMemo(
    () => tasks.filter((t) => t.assignedAgent === id),
    [tasks, id],
  );
  const agentActivity = useMemo(
    () => activity.filter((e) => e.agentId === id || e.targetAgentId === id),
    [activity, id],
  );

  if (!id || (!agent && !AGENTS_BY_ID[id])) notFound();
  if (!agent) return null;

  const department = getDepartment(agent.department);
  const meta = AGENT_STATUS[agent.status];
  const projects = PROJECTS.filter((p) => p.agents.includes(agent.id));
  const openTasks = agentTasks.filter((t) => t.status !== "COMPLETED" && t.status !== "FAILED");
  const doneTasks = agentTasks.filter((t) => t.status === "COMPLETED");
  const collaborators = agent.collaborators
    .map((cid) => AGENTS_BY_ID[cid])
    .filter(Boolean);
  const reports = agents.filter((a) => a.reportsTo === agent.id);

  return (
    <div className="space-y-5">
      <PageHeader
        backHref="/employees"
        backLabel="AI Employees"
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={agent.status} />
            <Chip>{department.name}</Chip>
            <Chip className={agent.seniority === "executive" ? "bg-accent/12 text-accent-soft" : ""}>
              {agent.seniority}
            </Chip>
          </div>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Avatar name={agent.name} accent={agent.accent} size="xl" status={agent.status} />
            <span>
              {agent.role}
              <span className="ml-3 font-mono text-sm font-normal tracking-[0.2em] text-ink-ghost">
                {agent.name}
              </span>
            </span>
          </span>
        }
        description={agent.title}
      />

      {/* Currently working on — the loudest element on the page. */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative overflow-hidden rounded-2xl border border-hairline bg-surface/70 p-6"
      >
        <div
          className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full blur-[90px]"
          style={{ background: `${agent.accent}22` }}
          aria-hidden
        />
        <div className="relative">
          <div className="flex items-center gap-2">
            <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot, meta.pulse && "animate-pulse-ring")} />
            <span className="label">Currently working on</span>
          </div>
          <p className="mt-3 text-xl font-medium leading-snug tracking-tight text-ink lg:text-2xl">
            {agent.currentTask ?? "待機中 — 新しい指示を待っています"}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            <Stat label="Status" value={meta.label} tone={meta.text} />
            <Stat
              label="Last active"
              value={agent.lastActiveMinutesAgo === 0 ? "now" : `${agent.lastActiveMinutesAgo}m ago`}
            />
            <Stat label="Open tasks" value={String(openTasks.length)} />
            <Stat label="Completed" value={agent.tasksCompleted.toLocaleString("en-US")} />
            <Stat label="Performance" value={`${agent.performance}%`} tone="text-live" />
          </div>
        </div>
      </motion.div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel className="overflow-hidden">
            <PanelHeader title="Role & Mission" />
            <div className="space-y-4 px-5 py-4">
              <Field label="Mission">{agent.mission}</Field>
              <Field label="Role prompt">
                <pre className="scroll-slim mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-hairline bg-black/30 p-3 font-mono text-2xs leading-relaxed text-ink-muted">
                  {agent.systemPrompt}
                </pre>
              </Field>
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader title="Task History" hint={`${agentTasks.length} ${agentTasks.length === 1 ? "task" : "tasks"}`} />
            {agentTasks.length === 0 ? (
              <p className="px-5 py-10 text-center text-xs text-ink-ghost">
                このAI社員に割り当てられたタスクはありません
              </p>
            ) : (
              <ul className="divide-y divide-hairline">
                {agentTasks.map((task) => (
                  <li key={task.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip className={TASK_STATUS[task.status].chip}>
                        {TASK_STATUS[task.status].label}
                      </Chip>
                      <Chip className={PRIORITY_META[task.priority].chip}>
                        {PRIORITY_META[task.priority].label}
                      </Chip>
                      <span className="num ml-auto text-3xs text-ink-ghost">
                        {formatRelative(task.updatedAt, now)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px] font-medium text-ink">{task.title}</p>
                    <p className="mt-0.5 text-2xs leading-relaxed text-ink-faint">
                      {task.description}
                    </p>
                    {task.status !== "COMPLETED" && (
                      <div className="mt-2 flex items-center gap-3">
                        <Progress value={task.progress} className="max-w-[200px] flex-1" />
                        <span className="num text-3xs text-ink-ghost">{task.progress}%</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader title="Communications" live hint="この社員に関わる活動" />
            <ActivityFeed events={agentActivity} limit={20} dense />
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel className="overflow-hidden">
            <PanelHeader title="Skills" />
            <div className="flex flex-wrap gap-1.5 px-5 py-4">
              {agent.skills.map((s) => (
                <Chip key={s} mono={false} className="bg-white/[0.05] text-ink-muted">
                  {s}
                </Chip>
              ))}
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader
              title="Tools"
              action={<Wrench className="h-3.5 w-3.5 text-ink-ghost" strokeWidth={1.75} />}
            />
            <ul className="grid grid-cols-2 gap-px bg-hairline">
              {agent.tools.map((t) => (
                <li
                  key={t}
                  className="bg-surface/60 px-4 py-2.5 font-mono text-3xs uppercase tracking-[0.12em] text-ink-muted"
                >
                  {t.replace(/_/g, " ")}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader
              title="Permissions"
              action={<KeyRound className="h-3.5 w-3.5 text-ink-ghost" strokeWidth={1.75} />}
            />
            <ul className="divide-y divide-hairline">
              {agent.permissions.map((p) => (
                <li key={p} className="flex items-center gap-2.5 px-5 py-2.5">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      GATED.has(p) ? "bg-warn" : "bg-live",
                    )}
                  />
                  <span className="text-2xs text-ink-muted">
                    {PERMISSION_LABEL[p] ?? p}
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t border-hairline px-5 py-2.5 text-3xs leading-relaxed text-ink-ghost">
              オレンジの権限は、実行前に必ずCEO承認を必要とします。
            </p>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader
              title="Reporting line"
              action={<Network className="h-3.5 w-3.5 text-ink-ghost" strokeWidth={1.75} />}
            />
            <div className="space-y-3 px-5 py-4">
              <div>
                <span className="label">Reports to</span>
                <div className="mt-1.5">
                  {agent.reportsTo ? (
                    <AgentChipLink id={agent.reportsTo} />
                  ) : (
                    <span className="text-2xs text-ink-faint">CEO（陽大）直下</span>
                  )}
                </div>
              </div>

              {reports.length > 0 && (
                <div>
                  <span className="label">Direct reports ({reports.length})</span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {reports.map((r) => (
                      <AgentChipLink key={r.id} id={r.id} />
                    ))}
                  </div>
                </div>
              )}

              {collaborators.length > 0 && (
                <div>
                  <span className="label">Collaborates with</span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {collaborators.map((c) => (
                      <AgentChipLink key={c.id} id={c.id} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Panel>

          {projects.length > 0 && (
            <Panel className="overflow-hidden">
              <PanelHeader title="Projects" />
              <ul className="divide-y divide-hairline">
                {projects.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/projects/${p.id}`}
                      className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-white/[0.025]"
                    >
                      <span className="flex-1 truncate text-2xs text-ink-muted">{p.name}</span>
                      <span className="num text-3xs text-ink-ghost">{p.progress}%</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel className="overflow-hidden">
            <PanelHeader
              title="Memory"
              action={<Brain className="h-3.5 w-3.5 text-ink-ghost" strokeWidth={1.75} />}
            />
            <ul className="divide-y divide-hairline">
              {agent.memory.map((m, i) => (
                <li key={i} className="px-5 py-3">
                  <p className="text-2xs leading-relaxed text-ink-muted">{m}</p>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader title="Performance" />
            <div className="space-y-4 px-5 py-4">
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xs text-ink-muted">Quality score</span>
                  <span className="num text-sm font-semibold text-ink">{agent.performance}%</span>
                </div>
                <Progress value={agent.performance} tone="live" className="mt-1.5" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Tasks completed" value={agent.tasksCompleted.toLocaleString("en-US")} />
                <Stat label="Open" value={String(openTasks.length)} />
                <Stat label="Closed today" value={String(doneTasks.length)} />
                <Stat label="Department" value={department.name} />
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={cn("num mt-1 text-[13px] font-medium", tone ?? "text-ink")}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="mt-1 text-xs leading-relaxed text-ink-muted">{children}</div>
    </div>
  );
}

function AgentChipLink({ id }: { id: string }) {
  const agent = AGENTS_BY_ID[id];
  if (!agent) return null;
  return (
    <Link
      href={`/employees/${agent.id}`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-white/[0.02] px-2 py-1 transition-colors hover:border-accent-line hover:bg-accent/[0.06]"
    >
      <Avatar name={agent.name} accent={agent.accent} size="xs" />
      <span className="text-3xs font-medium text-ink-muted">{agent.role}</span>
    </Link>
  );
}
