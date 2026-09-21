"use client";

import {
  AI_USAGE_7D,
  COMPANY_KPIS,
  DEPARTMENT_LOAD,
  FUNNEL,
  REVENUE_6M,
  THROUGHPUT_14D,
} from "@/lib/company/analytics";
import { DEPARTMENTS, DEPARTMENT_ACCENT } from "@/lib/company/departments";
import { useCompany } from "@/lib/store";
import { isActiveStatus } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Chip, Panel, PanelHeader, Progress } from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/page-header";
import {
  DepartmentBars,
  RevenueChart,
  ThroughputChart,
  UsageChart,
} from "@/components/ui/charts";

export default function AnalyticsPage() {
  const agents = useCompany((s) => s.agents);
  const active = agents.filter((a) => isActiveStatus(a.status)).length;

  const deptBars = DEPARTMENT_LOAD.map((d) => ({
    label: DEPARTMENTS.find((x) => x.id === d.department)?.name.slice(0, 4) ?? d.department,
    value: d.completed,
    color: DEPARTMENT_ACCENT[d.department],
  }));

  const maxFunnel = FUNNEL[0].value;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <div className="flex items-center gap-2">
            <span className="label">Company Analytics</span>
            <Chip className="bg-warn/10 text-warn">Mock data</Chip>
          </div>
        }
        title="Analytics"
        description="会社全体の生産性・収益・AI稼働の分析。実データ接続前はMock Dataで構造を確認できます。"
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline md:grid-cols-3 xl:grid-cols-6">
        {COMPANY_KPIS.map((k) => (
          <div key={k.label} className="bg-surface/70 px-5 py-4">
            <div className="label">{k.label}</div>
            <div className="num mt-1.5 text-lg font-semibold leading-none tracking-tight text-ink">
              {k.value}
            </div>
            <div
              className={cn(
                "num mt-1 text-[10px] font-medium",
                k.positive ? "text-live" : "text-danger",
              )}
            >
              {k.delta}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel className="overflow-hidden">
          <PanelHeader title="Task Throughput" hint="last 14 days" />
          <div className="px-4 py-4">
            <ThroughputChart data={THROUGHPUT_14D} height={220} />
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Revenue vs Cost" hint="last 6 months" />
          <div className="px-4 py-4">
            <RevenueChart data={REVENUE_6M} height={220} />
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Completed by Department" hint="this week" />
          <div className="px-4 py-4">
            <DepartmentBars data={deptBars} height={220} />
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="AI Usage" hint={`${active} employees active`} />
          <div className="px-4 py-4">
            <UsageChart data={AI_USAGE_7D} height={220} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel className="overflow-hidden">
          <PanelHeader title="Department Utilization" hint="稼働率" />
          <ul className="divide-y divide-hairline">
            {DEPARTMENT_LOAD.map((d) => {
              const meta = DEPARTMENTS.find((x) => x.id === d.department);
              return (
                <li key={d.department} className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: DEPARTMENT_ACCENT[d.department] }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                      {meta?.name ?? d.department}
                    </span>
                    <span className="num text-[10px] text-ink-ghost">
                      {d.active} active · {d.completed} done
                    </span>
                    <span
                      className={cn(
                        "num w-10 text-right text-[12px] font-semibold",
                        d.utilization >= 88
                          ? "text-warn"
                          : d.utilization >= 70
                            ? "text-live"
                            : "text-ink-muted",
                      )}
                    >
                      {d.utilization}%
                    </span>
                  </div>
                  <Progress
                    value={d.utilization}
                    tone={d.utilization >= 88 ? "warn" : "live"}
                    className="mt-2"
                  />
                </li>
              );
            })}
          </ul>
          <p className="border-t border-hairline px-5 py-3 text-[10px] leading-relaxed text-ink-ghost">
            88%を超える部署は、待機タスクが積み上がる前にリソース移動を検討してください。
          </p>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Partnership Funnel" hint="Re-Palette" />
          <ul className="space-y-3 px-5 py-4">
            {FUNNEL.map((f) => (
              <li key={f.stage}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] text-ink-muted">{f.stage}</span>
                  <span className="num text-[12px] font-semibold text-ink">{f.value}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                  <div
                    className="h-full rounded-full bg-accent/70 transition-[width] duration-700"
                    style={{ width: `${(f.value / maxFunnel) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
