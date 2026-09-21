"use client";

import Link from "next/link";
import { useCompany } from "@/lib/store";
import { DEPARTMENTS, DEPARTMENT_ACCENT } from "@/lib/company/departments";
import { DEPARTMENT_TASK_DELTA, TASK_TOTALS } from "@/lib/company/tasks";
import { THROUGHPUT_14D } from "@/lib/company/analytics";
import { cn } from "@/lib/utils";
import { Panel, PanelHeader, Progress } from "@/components/ui/primitives";
import { DepartmentBars, ThroughputChart } from "@/components/ui/charts";

export function TodayPerformance() {
  const tasks = useCompany((s) => s.tasks);

  const completed = tasks.filter((t) => t.status === "COMPLETED").length + TASK_TOTALS.padding;
  const inProgress = tasks.filter((t) => t.status === "RUNNING" || t.status === "PLANNING").length;
  const waiting = tasks.filter((t) => t.status === "WAITING" || t.status === "REVIEW").length;
  const total = TASK_TOTALS.today;
  const rate = Math.round((completed / total) * 100);

  const bars = DEPARTMENTS.map((d) => ({
    label: d.name.slice(0, 4),
    value: DEPARTMENT_TASK_DELTA[d.id],
    color: DEPARTMENT_ACCENT[d.id],
  }));

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Today's Performance"
        hint="09/21"
        action={
          <Link
            href="/analytics"
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-ghost transition-colors hover:text-accent-soft"
          >
            Analytics
          </Link>
        }
      />

      <div className="grid gap-px bg-hairline lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Counters */}
        <div className="bg-surface/60 px-5 py-4">
          <div className="flex items-baseline gap-2">
            <span className="num text-4xl font-semibold leading-none tracking-tight text-ink">
              {total}
            </span>
            <span className="text-xs text-ink-faint">tasks today</span>
          </div>

          <div className="mt-4 space-y-3">
            <Row label="Completed" value={completed} total={total} tone="live" />
            <Row label="In Progress" value={inProgress} total={total} tone="accent" />
            <Row label="Waiting" value={waiting} total={total} tone="warn" />
          </div>

          <div className="mt-5 border-t border-hairline pt-4">
            <div className="flex items-center justify-between">
              <span className="label">Completion rate</span>
              <span className="num text-sm font-semibold text-live">{rate}%</span>
            </div>
            <Progress value={rate} tone="live" className="mt-2" />
          </div>

          <div className="mt-5">
            <span className="label">Departments</span>
            <ul className="mt-2 space-y-1.5">
              {DEPARTMENTS.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/departments/${d.id}`}
                    className="group flex items-center gap-2 py-0.5"
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: DEPARTMENT_ACCENT[d.id] }}
                    />
                    <span className="flex-1 truncate text-[11px] text-ink-muted transition-colors group-hover:text-ink">
                      {d.name}
                    </span>
                    <span className="num text-[11px] font-medium text-live">
                      +{DEPARTMENT_TASK_DELTA[d.id]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Charts */}
        <div className="bg-surface/60 px-5 py-4">
          <span className="label">Throughput — last 14 days</span>
          <div className="mt-3">
            <ThroughputChart data={THROUGHPUT_14D} height={168} />
          </div>
          <div className="mt-2 flex items-center gap-4">
            <Legend color="#31D0A0" label="Completed" />
            <Legend color="#6C7CFF" label="Created" />
          </div>

          <div className="mt-5 border-t border-hairline pt-4">
            <span className="label">Tasks by department — today</span>
            <div className="mt-3">
              <DepartmentBars data={bars} height={150} />
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Row({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: "live" | "accent" | "warn";
}) {
  const pct = Math.round((value / total) * 100);
  const text = { live: "text-live", accent: "text-accent-soft", warn: "text-warn" }[tone];

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-ink-muted">{label}</span>
        <span className={cn("num text-sm font-semibold", text)}>{value}</span>
      </div>
      <Progress value={pct} tone={tone} className="mt-1.5" />
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-3 rounded-full" style={{ background: color }} />
      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-ghost">
        {label}
      </span>
    </span>
  );
}
