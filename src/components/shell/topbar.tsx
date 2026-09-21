"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bell, CornerDownLeft, Menu, PanelRight, Pause, Play, Search } from "lucide-react";
import { useCompany } from "@/lib/store";
import { isActiveStatus } from "@/lib/status";
import { formatClock, formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Button, LiveDot } from "@/components/ui/primitives";

export function Topbar({ onOpenNav }: { onOpenNav: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState("");

  const now = useCompany((s) => s.now);
  const hydrated = useCompany((s) => s.hydrated);
  const agents = useCompany((s) => s.agents);
  const notifications = useCompany((s) => s.notifications);
  const simulating = useCompany((s) => s.simulating);
  const toggleSimulation = useCompany((s) => s.toggleSimulation);
  const toggleRightPanel = useCompany((s) => s.toggleRightPanel);
  const runCommand = useCompany((s) => s.runCommand);

  const active = agents.filter((a) => isActiveStatus(a.status)).length;
  const unread = notifications.filter((n) => !n.read).length;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    runCommand(trimmed);
    setValue("");
    router.push("/command");
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-hairline bg-canvas/85 px-4 backdrop-blur-xl lg:px-6">
      <button
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="rounded-lg p-2 text-ink-faint transition-colors hover:bg-white/5 hover:text-ink lg:hidden"
      >
        <Menu className="h-4 w-4" strokeWidth={1.75} />
      </button>

      {/* Company clock */}
      <div className="hidden items-center gap-3 md:flex">
        <div className="flex items-baseline gap-2">
          <span className="num text-sm font-semibold tracking-tight text-ink">
            {hydrated ? formatClock(now) : formatClock(now)}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-ghost">
            JST
          </span>
        </div>
        <span className="h-3 w-px bg-hairline-strong" />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          {formatDate(now)}
        </span>
      </div>

      <span className="hidden h-3 w-px bg-hairline-strong md:block" />

      <div className="hidden items-center gap-2 md:flex">
        <LiveDot />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-live">
          {active} AI employees active
        </span>
      </div>

      {/* Command input */}
      <form onSubmit={submit} className="ml-auto flex min-w-0 max-w-md flex-1 items-center">
        <div className="group relative w-full">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-ghost"
            strokeWidth={1.75}
          />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="AI社員に指示する…"
            aria-label="Command"
            className="h-9 w-full rounded-lg border border-hairline bg-white/[0.03] pl-9 pr-16 text-xs text-ink placeholder:text-ink-ghost transition-colors focus:border-accent-line focus:bg-white/[0.05] focus:outline-none"
          />
          <kbd
            className={cn(
              "pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded border border-hairline px-1.5 py-0.5 font-mono text-[9px] text-ink-ghost sm:flex",
              value && "text-accent-soft",
            )}
          >
            <CornerDownLeft className="h-2.5 w-2.5" strokeWidth={2} />
            RUN
          </kbd>
        </div>
      </form>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSimulation}
          aria-label={simulating ? "Pause live simulation" : "Resume live simulation"}
          className="px-2"
          title={simulating ? "Pause live stream" : "Resume live stream"}
        >
          {simulating ? (
            <Pause className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </Button>

        <button
          onClick={toggleRightPanel}
          aria-label="Toggle notifications panel"
          className="relative rounded-lg p-2 text-ink-faint transition-colors hover:bg-white/5 hover:text-ink"
        >
          <Bell className="h-4 w-4" strokeWidth={1.75} />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-warn" />
          )}
        </button>

        <button
          onClick={toggleRightPanel}
          aria-label="Toggle side panel"
          className="hidden rounded-lg p-2 text-ink-faint transition-colors hover:bg-white/5 hover:text-ink xl:block"
        >
          <PanelRight className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}
