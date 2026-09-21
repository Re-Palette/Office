"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { DEPARTMENTS } from "@/lib/company/departments";
import { PROJECTS } from "@/lib/company/projects";
import { useCompany } from "@/lib/store";
import { isActiveStatus, PRIORITY_META, TASK_STATUS } from "@/lib/status";
import { formatRelative } from "@/lib/time";
import type { DepartmentId } from "@/lib/types";
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
import { DepartmentTag } from "@/components/company/department-tag";
import { ProjectList } from "@/components/company/project-list";

export default function DepartmentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as DepartmentId | undefined;

  const agents = useCompany((s) => s.agents);
  const tasks = useCompany((s) => s.tasks);
  const activity = useCompany((s) => s.activity);
  const now = useCompany((s) => s.now);

  const dept = DEPARTMENTS.find((d) => d.id === id);
  if (!dept) notFound();

  const head = AGENTS_BY_ID[dept.headAgentId];
  const members = agents.filter((a) => a.department === dept.id);
  const active = members.filter((a) => isActiveStatus(a.status));
  const deptTasks = tasks.filter((t) => t.department === dept.id);
  const open = deptTasks.filter((t) => t.status !== "COMPLETED" && t.status !== "FAILED");
  const done = deptTasks.filter((t) => t.status === "COMPLETED");
  const projects = PROJECTS.filter((p) => p.departments.includes(dept.id));
  const memberIds = new Set(members.map((m) => m.id));
  const deptActivity = activity.filter(
    (e) => memberIds.has(e.agentId) || (e.targetAgentId && memberIds.has(e.targetAgentId)),
  );
  const performance = Math.round(
    members.reduce((acc, m) => acc + m.performance, 0) / Math.max(1, members.length),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        backHref="/departments"
        backLabel="Departments"
        eyebrow={<DepartmentTag department={dept.id} size="md" />}
        title={dept.name}
        description={dept.mandate}
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline md:grid-cols-5">
        <Kpi label="Employees" value={`${active.length}/${members.length}`} sub="active now" />
        <Kpi label="Active tasks" value={String(open.length)} sub="in flight" />
        <Kpi label="Completed" value={String(done.length)} sub="today" />
        <Kpi label="Projects" value={String(projects.length)} sub="involved" />
        <Kpi label="Performance" value={`${performance}%`} sub="avg. quality" accent />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {head && (
            <Panel className="overflow-hidden">
              <PanelHeader title="Department Head" />
              <Link
                href={`/employees/${head.id}`}
                className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-white/[0.025]"
              >
                <Avatar name={head.name} accent={head.accent} size="lg" status={head.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{head.role}</span>
                    <span className="font-mono text-3xs uppercase tracking-[0.16em] text-ink-ghost">
                      {head.name}
                    </span>
                    <StatusPill status={head.status} />
                  </div>
                  <p className="mt-1 text-2xs leading-relaxed text-ink-faint">{head.mission}</p>
                  <p className="mt-2 text-2xs text-ink-muted">
                    <span className="label mr-2">Now</span>
                    {head.currentTask ?? "待機中"}
                  </p>
                </div>
              </Link>
            </Panel>
          )}

          <Panel className="overflow-hidden">
            <PanelHeader title="AI Employees" hint={`${members.length} 名`} />
            <ul className="grid gap-px bg-hairline sm:grid-cols-2">
              {members.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/employees/${m.id}`}
                    className="flex h-full items-start gap-3 bg-surface/60 px-4 py-3 transition-colors hover:bg-surface-hover/60"
                  >
                    <Avatar name={m.name} accent={m.accent} size="md" status={m.status} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate text-[12px] font-semibold text-ink">
                          {m.role}
                        </span>
                        <span className="truncate font-mono text-3xs uppercase tracking-[0.14em] text-ink-ghost">
                          {m.name}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-2xs text-ink-muted">
                        {m.currentTask ?? m.mission}
                      </p>
                      <div className="mt-1.5">
                        <StatusPill status={m.status} />
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader title="Tasks" hint={`${deptTasks.length} 件`} />
            {deptTasks.length === 0 ? (
              <p className="px-5 py-10 text-center text-xs text-ink-ghost">タスクはありません</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {deptTasks.map((t) => {
                  const owner = AGENTS_BY_ID[t.assignedAgent];
                  return (
                    <li key={t.id} className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip className={TASK_STATUS[t.status].chip}>
                          {TASK_STATUS[t.status].label}
                        </Chip>
                        <Chip className={PRIORITY_META[t.priority].chip}>
                          {PRIORITY_META[t.priority].label}
                        </Chip>
                        {owner && (
                          <Link
                            href={`/employees/${owner.id}`}
                            className="text-3xs text-ink-faint transition-colors hover:text-accent-soft"
                          >
                            {owner.role}
                          </Link>
                        )}
                        <span className="num ml-auto text-3xs text-ink-ghost">
                          {formatRelative(t.updatedAt, now)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[12px] font-medium text-ink">{t.title}</p>
                      {t.status !== "COMPLETED" && (
                        <Progress value={t.progress} className="mt-2 max-w-[260px]" />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel className="overflow-hidden">
            <PanelHeader title="Cross-department flow" hint="連携先" />
            <ul className="divide-y divide-hairline">
              {dept.interfaces.map((i) => {
                const target = DEPARTMENTS.find((d) => d.id === i);
                if (!target) return null;
                const targetHead = AGENTS_BY_ID[target.headAgentId];
                return (
                  <li key={i}>
                    <Link
                      href={`/departments/${i}`}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.025]"
                    >
                      <DepartmentTag department={dept.id} />
                      <ArrowRight className="h-3 w-3 shrink-0 text-ink-ghost" strokeWidth={2} />
                      <DepartmentTag department={i} />
                      {targetHead && (
                        <span className="ml-auto flex items-center gap-1.5">
                          <Avatar name={targetHead.name} accent={targetHead.accent} size="xs" />
                          <span className="text-3xs text-ink-faint">{targetHead.role}</span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>

          {projects.length > 0 && (
            <Panel className="overflow-hidden">
              <PanelHeader title="Projects" />
              <ProjectList projects={projects} dense />
            </Panel>
          )}

          <Panel className="overflow-hidden">
            <PanelHeader title="Department Activity" live />
            <ActivityFeed events={deptActivity} limit={24} dense />
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
        className={`num mt-1.5 text-2xl font-semibold leading-none tracking-tight ${
          accent ? "text-accent-soft" : "text-ink"
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-3xs text-ink-ghost">{sub}</div>
    </div>
  );
}
