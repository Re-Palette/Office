"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, PanelLeftClose } from "lucide-react";
import { NAV_GROUPS } from "@/lib/nav";
import { useCompany } from "@/lib/store";
import { isActiveStatus } from "@/lib/status";
import { signOut } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { LiveDot } from "@/components/ui/primitives";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();

  const agents = useCompany((s) => s.agents);
  const approvals = useCompany((s) => s.approvals);
  const tasks = useCompany((s) => s.tasks);

  const activeCount = agents.filter((a) => isActiveStatus(a.status)).length;
  const badges = {
    approvals: approvals.filter((a) => a.status === "pending").length,
    tasks: tasks.filter((t) => t.status !== "COMPLETED" && t.status !== "FAILED").length,
    agents: agents.length,
  };

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-hairline bg-surface/40 backdrop-blur-xl">
      {/* Identity */}
      <div className="px-5 pb-5 pt-6">
        <Link href="/" onClick={onNavigate} className="block">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[15px] font-semibold tracking-[0.22em] text-ink">
              FRIDAY
            </span>
          </div>
          <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.3em] text-ink-ghost">
            AI Company OS
          </span>
        </Link>
      </div>

      {/* Live strip */}
      <div className="mx-4 mb-4 flex items-center gap-2 rounded-lg border border-live/20 bg-live/[0.06] px-2.5 py-2">
        <LiveDot />
        <span className="num text-xs font-semibold text-live">{activeCount}</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-live/70">
          Active now
        </span>
      </div>

      {/* Navigation */}
      <nav className="scroll-slim flex-1 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label || `g${gi}`} className={cn(gi > 0 && "mt-5")}>
            {group.label && (
              <div className="px-2 pb-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-ink-ghost">
                {group.label}
              </div>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const Icon = item.icon;
                const badge = item.badge ? badges[item.badge] : undefined;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] transition-colors duration-150",
                        active
                          ? "bg-white/[0.06] text-ink"
                          : "text-ink-faint hover:bg-white/[0.035] hover:text-ink-muted",
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
                      )}
                      <Icon
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          active ? "text-accent-soft" : "text-ink-ghost group-hover:text-ink-faint",
                        )}
                        strokeWidth={1.75}
                      />
                      <span className="flex-1 font-mono text-[10px] uppercase tracking-[0.13em]">
                        {item.label}
                      </span>
                      {badge !== undefined && badge > 0 && (
                        <span className="num text-[10px] text-ink-ghost">{badge}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* CEO profile */}
      <div className="border-t border-hairline p-3">
        <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.03] px-2.5 py-2.5">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent/30 to-accent/5 font-mono text-[11px] font-semibold text-accent-soft ring-1 ring-inset ring-accent/25">
            陽
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-live ring-2 ring-surface" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-ink">陽大</div>
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-ghost">
              CEO · Online
            </div>
          </div>
          <button
            aria-label="Sign out"
            onClick={() => {
              signOut();
              router.push("/login");
            }}
            className="rounded-md p-1.5 text-ink-ghost transition-colors hover:bg-white/5 hover:text-ink-muted"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </aside>
  );
}

export { PanelLeftClose };
