"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { useCompany } from "@/lib/store";
import { AGENT_STATUS, isActiveStatus } from "@/lib/status";
import { DEPARTMENTS } from "@/lib/company/departments";
import { cn } from "@/lib/utils";
import type { Agent, DepartmentId } from "@/lib/types";
import { Avatar, FilterTabs, Panel, PanelHeader, StatusPill } from "@/components/ui/primitives";
import { DepartmentTag } from "@/components/company/department-tag";

type Scope = "active" | "executive" | "all";

export function LiveWorkforce() {
  const agents = useCompany((s) => s.agents);
  const [scope, setScope] = useState<Scope>("active");

  const shown = useMemo(() => {
    const list =
      scope === "active"
        ? agents.filter((a) => isActiveStatus(a.status) || a.status === "needs_approval")
        : scope === "executive"
          ? agents.filter((a) => a.seniority === "executive")
          : agents;

    // Executives first, then the most recently active.
    return [...list].sort((a, b) => {
      if (a.seniority !== b.seniority) return a.seniority === "executive" ? -1 : 1;
      return a.lastActiveMinutesAgo - b.lastActiveMinutesAgo;
    });
  }, [agents, scope]);

  const activeCount = agents.filter((a) => isActiveStatus(a.status)).length;

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Live AI Workforce"
        live
        hint={`${activeCount} / ${agents.length} 稼働中`}
        action={
          <div className="flex items-center gap-2">
            <FilterTabs<Scope>
              value={scope}
              onChange={setScope}
              options={[
                { id: "active", label: "Active" },
                { id: "executive", label: "C-Suite" },
                { id: "all", label: "All" },
              ]}
            />
            <Link
              href="/employees"
              className="hidden items-center gap-1 font-mono text-3xs uppercase tracking-[0.14em] text-ink-ghost transition-colors hover:text-accent-soft sm:flex"
            >
              全員
              <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-2 2xl:grid-cols-3">
        {shown.map((agent, i) => (
          <WorkforceCard key={agent.id} agent={agent} index={i} />
        ))}
      </div>

      {shown.length === 0 && (
        <p className="px-5 py-10 text-center text-xs text-ink-ghost">
          該当するAI社員がいません
        </p>
      )}

      <DepartmentPulse />
    </Panel>
  );
}

function WorkforceCard({ agent, index }: { agent: Agent; index: number }) {
  const meta = AGENT_STATUS[agent.status];

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.012, 0.25) }}
    >
      <Link
        href={`/employees/${agent.id}`}
        className="group flex h-full items-start gap-3 bg-surface/60 px-4 py-3.5 transition-colors duration-200 hover:bg-surface-hover/70"
      >
        <Avatar name={agent.name} accent={agent.accent} size="md" status={agent.status} />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13px] font-semibold text-ink">{agent.role}</span>
            <span className={cn("num shrink-0 text-3xs", meta.text)}>
              {agent.lastActiveMinutesAgo === 0 ? "now" : `${agent.lastActiveMinutesAgo}m`}
            </span>
          </div>

          <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-ink-muted">
            {agent.currentTask ?? agent.mission}
          </p>

          {/* Status and department — the codename was truncating to noise here. */}
          <div className="mt-2 flex items-center gap-2">
            <StatusPill status={agent.status} />
            <DepartmentTag department={agent.department} size="xs" className="min-w-0" />
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function DepartmentPulse() {
  const agents = useCompany((s) => s.agents);

  const rows = DEPARTMENTS.map((d) => {
    const members = agents.filter((a) => a.department === d.id);
    const active = members.filter((a) => isActiveStatus(a.status)).length;
    return { id: d.id as DepartmentId, label: d.label, active, total: members.length };
  });

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-hairline px-5 py-3">
      <span className="label">Department pulse</span>
      {rows.map((r) => (
        <Link
          key={r.id}
          href={`/departments/${r.id}`}
          className="group flex items-center gap-1.5"
        >
          <DepartmentTag department={r.id} size="xs" />
          <span
            className={cn(
              "num text-3xs",
              r.active > 0 ? "text-live" : "text-ink-faint",
            )}
          >
            {r.active}/{r.total}
          </span>
        </Link>
      ))}
    </div>
  );
}
