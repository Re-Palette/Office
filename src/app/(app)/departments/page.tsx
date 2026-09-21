"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { DEPARTMENTS, DEPARTMENT_ACCENT } from "@/lib/company/departments";
import { DEPARTMENT_TASK_DELTA } from "@/lib/company/tasks";
import { PROJECTS } from "@/lib/company/projects";
import { useCompany } from "@/lib/store";
import { isActiveStatus } from "@/lib/status";
import { Avatar, Chip, Panel, PanelHeader, Progress } from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/page-header";

export default function DepartmentsPage() {
  const agents = useCompany((s) => s.agents);
  const tasks = useCompany((s) => s.tasks);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<span className="label">Org Structure</span>}
        title="Departments"
        description="8つの部署。各部署はC-suiteのAI役員が統括し、部署間で直接連携します。"
      />

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        {DEPARTMENTS.map((dept, i) => {
          const head = AGENTS_BY_ID[dept.headAgentId];
          const members = agents.filter((a) => a.department === dept.id);
          const active = members.filter((a) => isActiveStatus(a.status)).length;
          const deptTasks = tasks.filter((t) => t.department === dept.id);
          const open = deptTasks.filter(
            (t) => t.status !== "COMPLETED" && t.status !== "FAILED",
          ).length;
          const done = deptTasks.filter((t) => t.status === "COMPLETED").length;
          const projects = PROJECTS.filter((p) => p.departments.includes(dept.id));
          const performance = Math.round(
            members.reduce((acc, m) => acc + m.performance, 0) / Math.max(1, members.length),
          );
          const accent = DEPARTMENT_ACCENT[dept.id];

          return (
            <motion.div
              key={dept.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.03 }}
            >
              <Link
                href={`/departments/${dept.id}`}
                className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-hairline bg-surface/70 p-5 transition-all duration-200 hover:border-hairline-strong hover:bg-surface-hover/50"
              >
                <span
                  className="absolute inset-x-0 top-0 h-px opacity-60"
                  style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
                  aria-hidden
                />

                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span
                      className="font-mono text-[9px] uppercase tracking-[0.2em]"
                      style={{ color: accent }}
                    >
                      {dept.label}
                    </span>
                    <h3 className="mt-1 text-base font-semibold tracking-tight text-ink">
                      {dept.name}
                    </h3>
                  </div>
                  <ArrowRight
                    className="h-3.5 w-3.5 shrink-0 text-ink-ghost transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink-muted"
                    strokeWidth={1.75}
                  />
                </div>

                <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-ink-faint">
                  {dept.mandate}
                </p>

                {head && (
                  <div className="mt-3.5 flex items-center gap-2.5 rounded-lg border border-hairline bg-white/[0.02] px-2.5 py-2">
                    <Avatar name={head.name} accent={head.accent} size="sm" status={head.status} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-medium text-ink">{head.role}</div>
                      <div className="truncate font-mono text-[9px] uppercase tracking-[0.14em] text-ink-ghost">
                        Department head
                      </div>
                    </div>
                  </div>
                )}

                <dl className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
                  <Cell label="Employees" value={`${active}/${members.length}`} />
                  <Cell label="Active tasks" value={String(open)} />
                  <Cell label="Completed" value={String(done + DEPARTMENT_TASK_DELTA[dept.id])} />
                  <Cell label="Projects" value={String(projects.length)} />
                </dl>

                <div className="mt-auto pt-4">
                  <div className="flex items-baseline justify-between">
                    <span className="label">Performance</span>
                    <span className="num text-xs font-semibold text-ink">{performance}%</span>
                  </div>
                  <Progress value={performance} tone="accent" className="mt-1.5" />
                </div>

                <div className="mt-3 flex -space-x-1.5">
                  {members.slice(0, 6).map((m) => (
                    <Avatar
                      key={m.id}
                      name={m.name}
                      accent={m.accent}
                      size="xs"
                      className="ring-2 ring-surface"
                    />
                  ))}
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>

      <Panel className="overflow-hidden">
        <PanelHeader title="Cross-department interfaces" hint="部署間の連携経路" />
        <ul className="divide-y divide-hairline">
          {DEPARTMENTS.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 px-5 py-3">
              <span
                className="w-28 shrink-0 font-mono text-[10px] uppercase tracking-[0.14em]"
                style={{ color: DEPARTMENT_ACCENT[d.id] }}
              >
                {d.label}
              </span>
              <ArrowRight className="h-3 w-3 shrink-0 text-ink-ghost" strokeWidth={2} />
              <div className="flex flex-wrap gap-1.5">
                {d.interfaces.map((i) => (
                  <Chip key={i}>{i}</Chip>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="num mt-0.5 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}
