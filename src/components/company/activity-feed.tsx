"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { ACTIVITY_META } from "@/lib/status";
import { formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ActivityEvent } from "@/lib/types";
import { Avatar, Empty } from "@/components/ui/primitives";

export function ActivityFeed({
  events,
  className,
  dense = false,
  limit,
}: {
  events: ActivityEvent[];
  className?: string;
  dense?: boolean;
  limit?: number;
}) {
  const visible = limit ? events.slice(0, limit) : events;

  if (visible.length === 0) {
    return <Empty title="活動はまだありません" hint="AI社員が動き始めるとここに流れます" />;
  }

  return (
    <ul className={cn("relative", className)}>
      {/* Timeline rail */}
      <span
        className="pointer-events-none absolute bottom-3 left-[68px] top-3 w-px bg-hairline"
        aria-hidden
      />
      <AnimatePresence initial={false}>
        {visible.map((event) => (
          <motion.li
            key={event.id}
            layout="position"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "relative flex gap-3 px-4 transition-colors hover:bg-white/[0.02]",
              dense ? "py-2" : "py-2.5",
            )}
          >
            <span className="num w-9 shrink-0 pt-px text-[10px] leading-5 text-ink-ghost">
              {formatTime(event.at)}
            </span>

            <span className="relative z-10 mt-1 flex h-3 w-3 shrink-0 items-center justify-center">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full ring-4 ring-surface",
                  event.severity === "important"
                    ? "bg-warn"
                    : event.kind === "agent.completed" || event.kind === "task.completed"
                      ? "bg-live"
                      : "bg-ink-ghost",
                )}
              />
            </span>

            <div className="min-w-0 flex-1 pl-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <AgentTag id={event.agentId} />
                <span
                  className={cn(
                    "font-mono text-[9px] uppercase tracking-[0.16em]",
                    ACTIVITY_META[event.kind]?.tone ?? "text-ink-ghost",
                  )}
                >
                  {ACTIVITY_META[event.kind]?.label ?? event.kind}
                </span>
                {event.targetAgentId && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-ink-ghost">
                    <ArrowRight className="h-2.5 w-2.5" strokeWidth={2} />
                    <AgentTag id={event.targetAgentId} muted />
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{event.message}</p>
              {event.detail && (
                <p className="mt-0.5 truncate text-[11px] text-ink-ghost">{event.detail}</p>
              )}
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function AgentTag({ id, muted }: { id: string; muted?: boolean }) {
  const agent = AGENTS_BY_ID[id];
  if (!agent) return <span className="text-[11px] text-ink-faint">{id}</span>;

  return (
    <Link
      href={`/employees/${agent.id}`}
      className={cn(
        "text-[11px] font-medium transition-colors hover:text-accent-soft",
        muted ? "text-ink-faint" : "text-ink",
      )}
    >
      {agent.role}
    </Link>
  );
}

export function ActivityAvatarRow({ events }: { events: ActivityEvent[] }) {
  const recent = Array.from(new Set(events.slice(0, 18).map((e) => e.agentId))).slice(0, 8);
  return (
    <div className="flex -space-x-1.5">
      {recent.map((id) => {
        const agent = AGENTS_BY_ID[id];
        if (!agent) return null;
        return (
          <Avatar
            key={id}
            name={agent.name}
            accent={agent.accent}
            size="xs"
            className="ring-2 ring-surface"
          />
        );
      })}
    </div>
  );
}
