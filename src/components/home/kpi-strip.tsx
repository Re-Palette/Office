"use client";

import Link from "next/link";
import { useCompany } from "@/lib/store";
import { isActiveStatus } from "@/lib/status";
import { PROJECTS } from "@/lib/company/projects";
import { TASK_TOTALS } from "@/lib/company/tasks";
import { cn } from "@/lib/utils";
import { LiveDot } from "@/components/ui/primitives";

export function KpiStrip() {
  const agents = useCompany((s) => s.agents);
  const tasks = useCompany((s) => s.tasks);
  const approvals = useCompany((s) => s.approvals);

  const active = agents.filter((a) => isActiveStatus(a.status)).length;
  const completed = tasks.filter((t) => t.status === "COMPLETED").length + TASK_TOTALS.padding;
  const pending = approvals.filter(
    (a) => a.status === "pending" || a.status === "reviewing",
  ).length;
  const activeProjects = PROJECTS.filter((p) => p.status === "active").length;

  const items = [
    { label: "AI Employees", value: agents.length, sub: `${active} active`, href: "/employees", live: true },
    { label: "Tasks Today", value: TASK_TOTALS.today, sub: `${completed} completed`, href: "/tasks" },
    { label: "Projects", value: PROJECTS.length, sub: `${activeProjects} active`, href: "/projects" },
    { label: "Departments", value: 8, sub: "all staffed", href: "/departments" },
    {
      label: "CEO Approval",
      value: pending,
      sub: pending > 0 ? "awaiting you" : "all clear",
      href: "/command",
      alert: pending > 0,
      // Five tiles into a 2- or 3-column grid would leave a hole; this fills it.
      span: "col-span-2 md:col-span-2 xl:col-span-1",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline md:grid-cols-3 xl:grid-cols-5">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className={cn(
            "group relative flex flex-col justify-between gap-3 bg-surface/70 px-5 py-4 transition-colors duration-200 hover:bg-surface-hover/60",
            item.alert && "bg-warn/[0.045] hover:bg-warn/[0.07]",
            item.span,
          )}
        >
          <div className="flex items-center gap-1.5">
            {item.live && <LiveDot />}
            <span className="label">{item.label}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "num text-[32px] font-semibold leading-none tracking-tight",
                item.alert ? "text-warn" : "text-ink",
              )}
            >
              {item.value}
            </span>
            <span
              className={cn(
                "text-2xs font-medium",
                item.alert ? "text-warn/80" : "text-ink-faint",
              )}
            >
              {item.sub}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
