"use client";

import Link from "next/link";
import { CalendarClock, Sunrise, Users2 } from "lucide-react";
import { NEXT_SCHEDULED } from "@/lib/company/reports";
import { useCompany } from "@/lib/store";
import { formatCountdown, formatTime } from "@/lib/time";

const ITEMS = [
  {
    icon: Sunrise,
    label: "Morning Briefing",
    at: NEXT_SCHEDULED.morningBriefing,
    href: "/reports/rep-briefing-0921",
    key: "morningBriefing" as const,
  },
  {
    icon: CalendarClock,
    label: "Daily Executive Report",
    at: NEXT_SCHEDULED.dailyReport,
    href: "/reports/rep-daily-0921",
    key: "dailyReport" as const,
  },
  {
    icon: Users2,
    label: "AI Board Meeting",
    at: NEXT_SCHEDULED.boardMeeting,
    href: "/meetings",
    key: "weeklyBoard" as const,
  },
];

export function ScheduleStrip() {
  const now = useCompany((s) => s.now);
  const schedule = useCompany((s) => s.schedule);

  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-3">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            href={item.href}
            className="group flex items-center gap-3 bg-surface/60 px-4 py-3 transition-colors hover:bg-surface-hover/60"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-ink-faint transition-colors group-hover:text-accent-soft">
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-medium text-ink">{item.label}</div>
              <div className="num text-[10px] text-ink-ghost">
                {schedule[item.key]} · {formatCountdown(item.at, now)}
              </div>
            </div>
            <span className="num shrink-0 text-[11px] text-ink-faint">
              {formatTime(item.at)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
