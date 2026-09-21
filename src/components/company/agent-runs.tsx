"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Cpu, Wrench } from "lucide-react";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { useCompany } from "@/lib/store";
import { formatRelative } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Avatar, Chip, Empty, Panel, PanelHeader } from "@/components/ui/primitives";

const STATUS: Record<string, { label: string; chip: string }> = {
  running: { label: "RUNNING", chip: "bg-live/12 text-live" },
  waiting_for_ceo: { label: "WAITING FOR CEO", chip: "bg-warn/12 text-warn" },
  completed: { label: "COMPLETED", chip: "bg-white/5 text-ink-muted" },
  failed: { label: "FAILED", chip: "bg-danger/10 text-danger" },
};

/**
 * What the AI employees are actually doing right now: which model call is in
 * flight, which tools it has reached for, and what it cost.
 */
export function AgentRuns({ limit = 8 }: { limit?: number }) {
  const runs = useCompany((s) => s.runs);
  const now = useCompany((s) => s.now);
  const mode = useCompany((s) => s.mode);
  const usage = useCompany((s) => s.apiUsage);
  const runtime = useCompany((s) => s.runtime);

  if (mode !== "live") return null;

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Agent Runs"
        live={runs.some((r) => r.status === "running")}
        hint={runtime?.model}
        action={
          <span className="num text-3xs text-ink-ghost">
            {usage.runs} runs · {(usage.inputTokens / 1000).toFixed(1)}k in ·{" "}
            {(usage.outputTokens / 1000).toFixed(1)}k out
          </span>
        }
      />

      {runs.length === 0 ? (
        <Empty
          title="まだ実行はありません"
          hint="Command Center から指示すると、AI社員が実際に動き始めます"
        />
      ) : (
        <ul className="divide-y divide-hairline">
          {runs.slice(0, limit).map((run) => {
            const agent = AGENTS_BY_ID[run.agentId];
            const status = STATUS[run.status] ?? STATUS.completed;

            return (
              <motion.li
                key={run.id}
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="px-5 py-3"
              >
                <div className="flex items-start gap-3">
                  {agent && (
                    <Avatar name={agent.name} accent={agent.accent} size="sm" status={agent.status} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={agent ? `/employees/${agent.id}` : "#"}
                        className="text-2xs font-semibold text-ink transition-colors hover:text-accent-soft"
                      >
                        {agent?.role ?? run.agentId}
                      </Link>
                      <Chip className={status.chip}>{status.label}</Chip>
                      {run.parentRunId && <Chip>delegated</Chip>}
                      <span className="num ml-auto text-3xs text-ink-ghost">
                        {formatRelative(run.startedAt, now)}
                      </span>
                    </div>

                    <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-ink-muted">
                      {run.objective}
                    </p>

                    {run.toolCalls.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <Wrench className="h-2.5 w-2.5 shrink-0 text-ink-ghost" strokeWidth={2} />
                        {[...new Set(run.toolCalls.map((t) => t.name))].slice(0, 6).map((name) => (
                          <span
                            key={name}
                            className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-3xs text-ink-faint"
                          >
                            {name}
                          </span>
                        ))}
                        <span className="num ml-1 text-3xs text-ink-ghost">
                          {run.toolCalls.length} calls · {run.steps} steps
                        </span>
                      </div>
                    )}

                    {run.error && (
                      <p className="mt-1.5 rounded-md border border-danger/25 bg-danger/[0.06] px-2 py-1 text-3xs leading-relaxed text-danger">
                        {run.error}
                      </p>
                    )}

                    {run.result && run.status === "completed" && (
                      <p className="mt-1.5 line-clamp-3 rounded-md border border-hairline bg-white/[0.02] px-2 py-1.5 text-3xs leading-relaxed text-ink-muted">
                        {run.result}
                      </p>
                    )}
                  </div>

                  <Cpu
                    className={cn(
                      "mt-0.5 h-3 w-3 shrink-0",
                      run.status === "running" ? "animate-pulse text-live" : "text-ink-ghost",
                    )}
                    strokeWidth={2}
                  />
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
