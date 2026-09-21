"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import { useCompany } from "@/lib/store";
import { DEPARTMENTS } from "@/lib/company/departments";
import { AGENT_STATUS, isActiveStatus } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { Agent } from "@/lib/types";
import {
  Avatar,
  Chip,
  FilterTabs,
  Panel,
  Progress,
  StatusPill,
} from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/page-header";
import { DepartmentTag } from "@/components/company/department-tag";

type Filter = "all" | "executive" | (typeof DEPARTMENTS)[number]["id"];

export default function EmployeesPage() {
  const agents = useCompany((s) => s.agents);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents
      .filter((a) => {
        if (filter === "all") return true;
        if (filter === "executive") return a.seniority === "executive";
        return a.department === filter;
      })
      .filter((a) => {
        if (!q) return true;
        return `${a.name} ${a.role} ${a.title} ${a.mission} ${a.skills.join(" ")}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => {
        if (a.seniority !== b.seniority) return a.seniority === "executive" ? -1 : 1;
        return b.performance - a.performance;
      });
  }, [agents, filter, query]);

  const options: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: agents.length },
    {
      id: "executive",
      label: "Executive",
      count: agents.filter((a) => a.seniority === "executive").length,
    },
    ...DEPARTMENTS.map((d) => ({
      id: d.id as Filter,
      label: d.name,
      count: agents.filter((a) => a.department === d.id).length,
    })),
  ];

  const active = agents.filter((a) => isActiveStatus(a.status)).length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <span className="label">AI Workforce</span>
        }
        title="AI Employees"
        description={`${agents.length} 名のAI社員が8部署に所属しています。現在 ${active} 名が稼働中。`}
        actions={
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-ghost"
              strokeWidth={1.75}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="名前・役職・スキルで検索"
              aria-label="Search AI employees"
              className="h-9 w-[240px] rounded-lg border border-hairline bg-white/[0.03] pl-9 pr-3 text-xs text-ink placeholder:text-ink-ghost focus:border-accent-line focus:outline-none"
            />
          </div>
        }
      />

      <Panel className="px-4 py-2.5">
        <FilterTabs<Filter> options={options} value={filter} onChange={setFilter} />
      </Panel>

      {filtered.length === 0 ? (
        <Panel className="px-5 py-14 text-center">
          <p className="text-sm text-ink-muted">該当するAI社員が見つかりません</p>
        </Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((agent, i) => (
            <EmployeeCard key={agent.id} agent={agent} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmployeeCard({ agent, index }: { agent: Agent; index: number }) {
  const meta = AGENT_STATUS[agent.status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.015, 0.3) }}
    >
      <Link
        href={`/employees/${agent.id}`}
        className="group flex h-full flex-col rounded-2xl border border-hairline bg-surface/70 p-4 transition-all duration-200 hover:border-hairline-strong hover:bg-surface-hover/50"
      >
        <div className="flex items-start gap-3">
          <Avatar name={agent.name} accent={agent.accent} size="lg" status={agent.status} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">{agent.role}</div>
            <div className="truncate font-mono text-3xs uppercase tracking-[0.16em] text-ink-ghost">
              {agent.name}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <DepartmentTag department={agent.department} size="xs" />
              {agent.seniority === "executive" && (
                <Chip className="bg-accent/20 text-accent-soft">C-Suite</Chip>
              )}
            </div>
          </div>
        </div>

        <p className="mt-3 line-clamp-2 text-2xs leading-relaxed text-ink-faint">
          {agent.mission}
        </p>

        <div className="mt-3 rounded-lg border border-hairline bg-white/[0.02] px-2.5 py-2">
          <span className="label">Current task</span>
          <p className={cn("mt-1 line-clamp-2 text-2xs leading-snug", meta.text)}>
            {agent.currentTask ?? "待機中"}
          </p>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <StatusPill status={agent.status} />
          <span className="num text-3xs text-ink-ghost">
            {agent.lastActiveMinutesAgo === 0 ? "active now" : `${agent.lastActiveMinutesAgo}m ago`}
          </span>
        </div>

        <div className="mt-auto pt-3.5">
          <div className="flex items-baseline justify-between">
            <span className="label">Performance</span>
            <div className="flex items-baseline gap-2">
              <span className="num text-2xs text-ink-ghost">
                {agent.tasksCompleted.toLocaleString("en-US")} done
              </span>
              <span className="num text-xs font-semibold text-ink">{agent.performance}%</span>
            </div>
          </div>
          <Progress
            value={agent.performance}
            tone={agent.performance >= 94 ? "live" : "accent"}
            className="mt-1.5"
          />
        </div>
      </Link>
    </motion.div>
  );
}
