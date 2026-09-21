"use client";

import { useMemo, useState } from "react";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { DEPARTMENTS } from "@/lib/company/departments";
import { useCompany } from "@/lib/store";
import { ACTIVITY_META } from "@/lib/status";
import { FilterTabs, LiveDot, Panel, PanelHeader } from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/page-header";
import { ActivityFeed, ActivityAvatarRow } from "@/components/company/activity-feed";
import { AgentRuns } from "@/components/company/agent-runs";

type Scope = "all" | "handoff" | "approval" | "insight" | (typeof DEPARTMENTS)[number]["id"];

export default function ActivityPage() {
  const activity = useCompany((s) => s.activity);
  const simulating = useCompany((s) => s.simulating);
  const [scope, setScope] = useState<Scope>("all");

  const filtered = useMemo(() => {
    return activity.filter((e) => {
      if (scope === "all") return true;
      if (scope === "handoff") return e.kind === "agent.handoff" || e.kind === "task.assigned";
      if (scope === "approval") return e.kind.startsWith("approval.");
      if (scope === "insight") return e.kind === "insight.found";
      return AGENTS_BY_ID[e.agentId]?.department === scope;
    });
  }, [activity, scope]);

  const kinds = Object.entries(
    activity.reduce<Record<string, number>>((acc, e) => {
      acc[e.kind] = (acc[e.kind] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <div className="flex items-center gap-2">
            <LiveDot />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-live">
              {simulating ? "Streaming" : "Paused"}
            </span>
          </div>
        }
        title="Activity"
        description="AI社員のすべての行動はイベントとして記録され、この単一のストリームに集約されます。"
        actions={<ActivityAvatarRow events={activity} />}
      />

      <Panel className="px-4 py-2.5">
        <FilterTabs<Scope>
          value={scope}
          onChange={setScope}
          options={[
            { id: "all", label: "All", count: activity.length },
            { id: "handoff", label: "Hand-offs" },
            { id: "approval", label: "Approvals" },
            { id: "insight", label: "Insights" },
            ...DEPARTMENTS.map((d) => ({ id: d.id as Scope, label: d.name })),
          ]}
        />
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Panel className="overflow-hidden">
          <PanelHeader title="Live Activity" live hint={`${filtered.length} events`} />
          <ActivityFeed events={filtered} limit={120} />
        </Panel>

        <div className="space-y-5">
        <AgentRuns limit={5} />

        <Panel className="overflow-hidden">
          <PanelHeader title="Event Types" hint="Activity Engine" />
          <ul className="divide-y divide-hairline">
            {kinds.map(([kind, count]) => (
              <li key={kind} className="flex items-center gap-3 px-5 py-2.5">
                <span
                  className={`font-mono text-[9px] uppercase tracking-[0.16em] ${
                    ACTIVITY_META[kind]?.tone ?? "text-ink-ghost"
                  }`}
                >
                  {ACTIVITY_META[kind]?.label ?? kind}
                </span>
                <code className="truncate font-mono text-[10px] text-ink-ghost">{kind}</code>
                <span className="num ml-auto text-[11px] text-ink-muted">{count}</span>
              </li>
            ))}
          </ul>
        </Panel>
        </div>
      </div>
    </div>
  );
}
