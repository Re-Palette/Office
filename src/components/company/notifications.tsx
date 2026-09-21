"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowUpRight,
  BellRing,
  CalendarClock,
  CheckCircle2,
  FileText,
  Lightbulb,
  Sparkles,
} from "lucide-react";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { useCompany } from "@/lib/store";
import { NOTIFICATION_LEVEL } from "@/lib/status";
import { formatRelative } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { NotificationItem, NotificationKind } from "@/lib/types";
import { Button, Empty, FilterTabs } from "@/components/ui/primitives";

const KIND_ICON: Record<NotificationKind, typeof BellRing> = {
  approval: BellRing,
  report: FileText,
  error: AlertOctagon,
  task_completed: CheckCircle2,
  discovery: Sparkles,
  deadline: CalendarClock,
  recommendation: Lightbulb,
};

const KIND_TONE: Record<NotificationKind, string> = {
  approval: "text-warn bg-warn/10",
  report: "text-accent-soft bg-accent/10",
  error: "text-danger bg-danger/10",
  task_completed: "text-live bg-live/10",
  discovery: "text-[#5BC8D8] bg-[#5BC8D8]/10",
  deadline: "text-warn bg-warn/10",
  recommendation: "text-accent-soft bg-accent/10",
};

type Filter = "all" | "unread" | "action";

export function Notifications() {
  const notifications = useCompany((s) => s.notifications);
  const markAllRead = useCompany((s) => s.markNotificationsRead);
  const [filter, setFilter] = useState<Filter>("all");

  const unread = notifications.filter((n) => !n.read);
  const action = notifications.filter(
    (n) => n.level === "APPROVAL_REQUIRED" || n.level === "URGENT" || n.level === "ERROR",
  );

  const shown =
    filter === "unread" ? unread : filter === "action" ? action : notifications;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-2">
        <FilterTabs<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "All", count: notifications.length },
            { id: "unread", label: "Unread", count: unread.length },
            { id: "action", label: "Action", count: action.length },
          ]}
        />
        {unread.length > 0 && (
          <Button variant="ghost" size="xs" onClick={markAllRead} className="shrink-0">
            Mark all read
          </Button>
        )}
      </div>

      {shown.length === 0 ? (
        <Empty title="通知はありません" hint="AI社員があなたの判断を必要としたときに届きます" />
      ) : (
        <ul className="divide-y divide-hairline">
          <AnimatePresence initial={false}>
            {shown.map((n) => (
              <motion.li
                key={n.id}
                layout="position"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <NotificationRow notification={n} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

function NotificationRow({ notification: n }: { notification: NotificationItem }) {
  const router = useRouter();
  const now = useCompany((s) => s.now);
  const markRead = useCompany((s) => s.markNotificationRead);

  const Icon = KIND_ICON[n.kind];
  const level = NOTIFICATION_LEVEL[n.level];
  const agent = n.agentId ? AGENTS_BY_ID[n.agentId] : undefined;
  const demandsAction = n.level === "APPROVAL_REQUIRED" || n.level === "URGENT";

  function open() {
    markRead(n.id);
    if (n.href) router.push(n.href);
  }

  return (
    <div
      className={cn(
        "group flex gap-3 px-4 py-3 transition-colors hover:bg-white/[0.025]",
        !n.read && "bg-white/[0.02]",
        demandsAction && !n.read && "bg-warn/[0.045]",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
          KIND_TONE[n.kind],
        )}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {demandsAction && (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em]",
                level.chip,
              )}
            >
              {level.label}
            </span>
          )}
          {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
          <span className="num ml-auto text-[10px] text-ink-ghost">
            {formatRelative(n.createdAt, now)}
          </span>
        </div>

        <button
          onClick={open}
          className="mt-1 block w-full text-left text-xs font-medium text-ink transition-colors hover:text-accent-soft"
        >
          {n.title}
        </button>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">{n.message}</p>

        <div className="mt-1.5 flex items-center gap-2">
          {agent && (
            <Link
              href={`/employees/${agent.id}`}
              className="text-[10px] text-ink-ghost transition-colors hover:text-accent-soft"
            >
              {agent.role}
            </Link>
          )}
          {n.href && (
            <button
              onClick={open}
              className={cn(
                "ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] transition-colors",
                demandsAction
                  ? "bg-warn/12 text-warn hover:bg-warn/20"
                  : "text-ink-faint hover:bg-white/5 hover:text-ink",
              )}
            >
              {n.actionLabel ?? "Open"}
              <ArrowUpRight className="h-2.5 w-2.5" strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A single quiet line under the topbar when something genuinely cannot wait.
 * It shows only the newest unread URGENT / APPROVAL_REQUIRED item and can be
 * dismissed, so it never becomes wallpaper.
 */
export function NotificationBanner() {
  const router = useRouter();
  const notifications = useCompany((s) => s.notifications);
  const dismissedId = useCompany((s) => s.dismissedBannerId);
  const dismiss = useCompany((s) => s.dismissBanner);
  const markRead = useCompany((s) => s.markNotificationRead);

  const urgent = notifications
    .filter((n) => !n.read && NOTIFICATION_LEVEL[n.level].banner)
    .sort((a, b) => b.createdAt - a.createdAt)[0];

  if (!urgent || urgent.id === dismissedId) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="overflow-hidden border-b border-warn/20 bg-warn/[0.07]"
      >
        <div className="mx-auto flex w-full max-w-[1800px] items-center gap-3 px-4 py-2 lg:px-7 2xl:max-w-[2100px]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" strokeWidth={1.75} />
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-warn">
            CEO action required
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink-muted">
            {urgent.message}
          </span>
          {urgent.href && (
            <Button
              variant="subtle"
              size="xs"
              className="shrink-0 bg-warn/15 text-warn hover:bg-warn/25"
              onClick={() => {
                markRead(urgent.id);
                router.push(urgent.href!);
              }}
            >
              Review
            </Button>
          )}
          <button
            onClick={() => dismiss(urgent.id)}
            aria-label="Dismiss"
            className="shrink-0 rounded-md px-1.5 py-1 text-[10px] text-ink-ghost transition-colors hover:bg-white/5 hover:text-ink-faint"
          >
            ✕
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
