"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { CheckCircle2, Circle } from "lucide-react";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { DEPARTMENTS, DEPARTMENT_ACCENT } from "@/lib/company/departments";
import { PROJECTS } from "@/lib/company/projects";
import { KNOWLEDGE } from "@/lib/company/knowledge";
import { useCompany } from "@/lib/store";
import { PRIORITY_META, TASK_STATUS } from "@/lib/status";
import { formatCountdown, formatDay, formatRelative } from "@/lib/time";
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
import { PROJECT_HEALTH } from "@/components/company/project-list";

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const tasks = useCompany((s) => s.tasks);
  const activity = useCompany((s) => s.activity);
  const agents = useCompany((s) => s.agents);
  const now = useCompany((s) => s.now);

  const project = PROJECTS.find((p) => p.id === id);
  if (!project) notFound();

  const health = PROJECT_HEALTH[project.health];
  const owner = AGENTS_BY_ID[project.owner];
  const team = project.agents.map((a) => agents.find((x) => x.id === a)).filter(Boolean);
  const projectTasks = tasks.filter((t) => t.project === project.id);
  const open = projectTasks.filter((t) => t.status !== "COMPLETED" && t.status !== "FAILED");
  const done = projectTasks.filter((t) => t.status === "COMPLETED");
  const teamIds = new Set(project.agents);
  const projectActivity = activity.filter(
    (e) => e.projectId === project.id || teamIds.has(e.agentId),
  );
  const docs = KNOWLEDGE.filter((k) =>
    k.tags.some((t) => t === project.id || t === project.name.toLowerCase()),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        backHref="/projects"
        backLabel="Projects"
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <Chip className={health.chip}>{health.label}</Chip>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-ghost">
              {project.codename}
            </span>
          </div>
        }
        title={project.name}
        description={project.summary}
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline md:grid-cols-5">
        <Kpi label="Progress" value={`${project.progress}%`} sub={health.label.toLowerCase()} accent />
        <Kpi label="Open tasks" value={String(open.length)} sub="in flight" />
        <Kpi label="Completed" value={String(done.length)} sub="today" />
        <Kpi label="AI employees" value={String(project.agents.length)} sub="assigned" />
        <Kpi
          label="Deadline"
          value={formatCountdown(project.deadline, now)}
          sub={formatDay(project.deadline)}
        />
      </div>

      <Panel className="px-5 py-4">
        <div className="flex items-center justify-between">
          <span className="label">Overall progress</span>
          <span className="num text-sm font-semibold text-ink">{project.progress}%</span>
        </div>
        <Progress value={project.progress} tone={health.tone} className="mt-2 h-1.5" />
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel className="overflow-hidden">
            <PanelHeader title="Milestones" hint={`${project.milestones.filter((m) => m.done).length}/${project.milestones.length}`} />
            <ol className="divide-y divide-hairline">
              {project.milestones.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                  {m.done ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-live" strokeWidth={1.75} />
                  ) : (
                    <Circle className="h-3.5 w-3.5 shrink-0 text-ink-ghost" strokeWidth={1.75} />
                  )}
                  <span
                    className={cn(
                      "flex-1 text-[12px]",
                      m.done ? "text-ink-faint line-through" : "text-ink",
                    )}
                  >
                    {m.label}
                  </span>
                  <span className="num text-[10px] text-ink-ghost">{formatDay(m.due)}</span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader title="Tasks" hint={`${projectTasks.length} 件`} />
            {projectTasks.length === 0 ? (
              <p className="px-5 py-10 text-center text-xs text-ink-ghost">
                このプロジェクトのタスクはまだありません
              </p>
            ) : (
              <ul className="divide-y divide-hairline">
                {projectTasks.map((t) => {
                  const assignee = AGENTS_BY_ID[t.assignedAgent];
                  return (
                    <li key={t.id} className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip className={TASK_STATUS[t.status].chip}>
                          {TASK_STATUS[t.status].label}
                        </Chip>
                        <Chip className={PRIORITY_META[t.priority].chip}>
                          {PRIORITY_META[t.priority].label}
                        </Chip>
                        <span className="num ml-auto text-[10px] text-ink-ghost">
                          {formatRelative(t.updatedAt, now)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[12px] font-medium text-ink">{t.title}</p>
                      <div className="mt-2 flex items-center gap-3">
                        {assignee && (
                          <Link
                            href={`/employees/${assignee.id}`}
                            className="flex items-center gap-1.5"
                          >
                            <Avatar name={assignee.name} accent={assignee.accent} size="xs" />
                            <span className="text-[10px] text-ink-faint transition-colors hover:text-accent-soft">
                              {assignee.role}
                            </span>
                          </Link>
                        )}
                        {t.status !== "COMPLETED" && (
                          <>
                            <Progress value={t.progress} className="max-w-[160px] flex-1" />
                            <span className="num text-[10px] text-ink-ghost">{t.progress}%</span>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader title="Recent Activity" live />
            <ActivityFeed events={projectActivity} limit={20} dense />
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel className="overflow-hidden">
            <PanelHeader title="Assigned AI Employees" hint={`${team.length} 名`} />
            <ul className="divide-y divide-hairline">
              {team.map((m) =>
                m ? (
                  <li key={m.id}>
                    <Link
                      href={`/employees/${m.id}`}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.025]"
                    >
                      <Avatar name={m.name} accent={m.accent} size="sm" status={m.status} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate text-[11px] font-medium text-ink">
                            {m.role}
                          </span>
                          {m.id === project.owner && (
                            <Chip className="bg-accent/12 text-accent-soft">Owner</Chip>
                          )}
                        </div>
                        <p className="truncate text-[10px] text-ink-ghost">
                          {m.currentTask ?? m.mission}
                        </p>
                      </div>
                      <StatusPill status={m.status} showLabel={false} />
                    </Link>
                  </li>
                ) : null,
              )}
            </ul>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader title="Departments" />
            <ul className="divide-y divide-hairline">
              {project.departments.map((d) => {
                const dept = DEPARTMENTS.find((x) => x.id === d);
                if (!dept) return null;
                return (
                  <li key={d}>
                    <Link
                      href={`/departments/${d}`}
                      className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-white/[0.025]"
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: DEPARTMENT_ACCENT[d] }}
                      />
                      <span className="flex-1 text-[11px] text-ink-muted">{dept.name}</span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-ghost">
                        {dept.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>

          {owner && (
            <Panel className="overflow-hidden">
              <PanelHeader title="Project Owner" />
              <Link
                href={`/employees/${owner.id}`}
                className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-white/[0.025]"
              >
                <Avatar name={owner.name} accent={owner.accent} size="md" status={owner.status} />
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-ink">{owner.role}</div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                    {owner.mission}
                  </p>
                </div>
              </Link>
            </Panel>
          )}

          <Panel className="overflow-hidden">
            <PanelHeader title="Reports & Documents" hint={`${docs.length} 件`} />
            {docs.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-ink-ghost">
                関連ドキュメントはまだありません
              </p>
            ) : (
              <ul className="divide-y divide-hairline">
                {docs.map((d) => (
                  <li key={d.id}>
                    <Link
                      href="/knowledge"
                      className="block px-5 py-3 transition-colors hover:bg-white/[0.025]"
                    >
                      <div className="text-[11px] font-medium text-ink">{d.title}</div>
                      <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-ink-faint">
                        {d.excerpt}
                      </p>
                      <span className="num mt-1 block text-[10px] text-ink-ghost">
                        {formatRelative(d.updatedAt, now)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-surface/70 px-5 py-4">
      <div className="label">{label}</div>
      <div
        className={cn(
          "num mt-1.5 text-2xl font-semibold leading-none tracking-tight",
          accent ? "text-accent-soft" : "text-ink",
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-[10px] text-ink-ghost">{sub}</div>
    </div>
  );
}
