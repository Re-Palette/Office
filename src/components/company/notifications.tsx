"use client";

import { AlertOctagon, BellRing, CalendarClock, CheckCircle2, Lightbulb, Sparkles } from "lucide-react";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { useCompany } from "@/lib/store";
import { formatRelative } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { NotificationItem } from "@/lib/types";
import { Button, Empty } from "@/components/ui/primitives";

const KIND: Record<NotificationItem["kind"], { icon: typeof BellRing; tone: string; label: string }> = {
  approval: { icon: BellRing, tone: "text-warn bg-warn/10", label: "APPROVAL" },
  error: { icon: AlertOctagon, tone: "text-danger bg-danger/10", label: "ERROR" },
  task_completed: { icon: CheckCircle2, tone: "text-live bg-live/10", label: "COMPLETED" },
  discovery: { icon: Sparkles, tone: "text-[#5BC8D8] bg-[#5BC8D8]/10", label: "DISCOVERY" },
  deadline: { icon: CalendarClock, tone: "text-warn bg-warn/10", label: "DEADLINE" },
  recommendation: { icon: Lightbulb, tone: "text-accent-soft bg-accent/10", label: "PROPOSAL" },
};

export function Notifications() {
  const notifications = useCompany((s) => s.notifications);
  const now = useCompany((s) => s.now);
  const markRead = useCompany((s) => s.markNotificationsRead);

  if (notifications.length === 0) {
    return <Empty title="通知はありません" />;
  }

  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div>
      {unread > 0 && (
        <div className="flex items-center justify-between border-b border-hairline px-4 py-2">
          <span className="num text-[10px] text-ink-faint">{unread} unread</span>
          <Button variant="ghost" size="xs" onClick={markRead}>
            Mark all read
          </Button>
        </div>
      )}
      <ul className="divide-y divide-hairline">
        {notifications.map((n) => {
          const meta = KIND[n.kind];
          const Icon = meta.icon;
          const agent = n.agentId ? AGENTS_BY_ID[n.agentId] : undefined;

          return (
            <li
              key={n.id}
              className={cn(
                "flex gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02]",
                !n.read && "bg-white/[0.015]",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                  meta.tone,
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-ink">{n.title}</span>
                  {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">{n.body}</p>
                <div className="mt-1 flex items-center gap-2">
                  {agent && (
                    <span className="text-[10px] text-ink-ghost">{agent.role}</span>
                  )}
                  <span className="num text-[10px] text-ink-ghost">
                    {formatRelative(n.at, now)}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
