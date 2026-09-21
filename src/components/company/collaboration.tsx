"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { PROJECTS_BY_ID } from "@/lib/company/projects";
import { useCompany } from "@/lib/store";
import { formatRelative, formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { CollaborationFlow } from "@/lib/types";
import { Avatar, Chip, Empty } from "@/components/ui/primitives";

export function CollaborationFlows({ limit = 3 }: { limit?: number }) {
  const flows = useCompany((s) => s.flows);
  const now = useCompany((s) => s.now);

  if (flows.length === 0) {
    return <Empty title="進行中の連携はありません" hint="CEOの指示から仕事の流れが生まれます" />;
  }

  return (
    <div className="grid gap-px bg-hairline lg:grid-cols-2 2xl:grid-cols-3">
      {flows.slice(0, limit).map((flow) => (
        <FlowColumn key={flow.id} flow={flow} now={now} />
      ))}
    </div>
  );
}

function FlowColumn({ flow, now }: { flow: CollaborationFlow; now: number }) {
  const done = flow.steps.filter((s) => s.state === "done").length;
  const project = flow.projectId ? PROJECTS_BY_ID[flow.projectId] : undefined;

  return (
    <div className="bg-surface/60 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Chip
              className={cn(
                flow.origin === "CEO"
                  ? "bg-accent/12 text-accent-soft"
                  : "bg-white/5 text-ink-faint",
              )}
            >
              {flow.origin}
            </Chip>
            {project && <Chip>{project.name}</Chip>}
          </div>
          <h4 className="mt-1.5 truncate text-[13px] font-medium text-ink">{flow.title}</h4>
        </div>
        <span className="num shrink-0 text-[10px] text-ink-ghost">
          {done}/{flow.steps.length}
        </span>
      </div>

      <ol className="relative mt-3.5">
        {flow.steps.map((step, i) => {
          const agent = AGENTS_BY_ID[step.agentId];
          const last = i === flow.steps.length - 1;

          return (
            <li key={step.id} className="relative flex gap-3 pb-3.5 last:pb-0">
              {/* connector */}
              {!last && (
                <span
                  className={cn(
                    "absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-px",
                    step.state === "done" ? "bg-live/35" : "bg-hairline",
                  )}
                  aria-hidden
                />
              )}
              {!last && step.state === "active" && (
                <motion.span
                  className="absolute left-[11.5px] top-7 h-1.5 w-1.5 rounded-full bg-accent"
                  animate={{ y: [0, 18, 18], opacity: [0, 1, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                  aria-hidden
                />
              )}

              <span className="relative z-10 shrink-0">
                {agent ? (
                  <Avatar
                    name={agent.name}
                    accent={agent.accent}
                    size="sm"
                    className={cn(step.state === "queued" && "opacity-40")}
                  />
                ) : (
                  <span className="block h-7 w-7 rounded-lg bg-white/5" />
                )}
              </span>

              <div className={cn("min-w-0 flex-1", step.state === "queued" && "opacity-45")}>
                <div className="flex items-center gap-2">
                  <Link
                    href={agent ? `/employees/${agent.id}` : "#"}
                    className="truncate text-[11px] font-semibold text-ink transition-colors hover:text-accent-soft"
                  >
                    {agent?.role ?? step.agentId}
                  </Link>
                  {step.state === "active" && (
                    <span className="flex items-center gap-1">
                      <span className="h-1 w-1 animate-pulse rounded-full bg-accent" />
                      <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-accent-soft">
                        in progress
                      </span>
                    </span>
                  )}
                  {step.state === "done" && step.at && (
                    <span className="num text-[9px] text-ink-ghost">{formatTime(step.at)}</span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">{step.action}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-2 border-t border-hairline pt-2">
        <span className="num text-[10px] text-ink-ghost">
          started {formatRelative(flow.startedAt, now)}
        </span>
      </div>
    </div>
  );
}
