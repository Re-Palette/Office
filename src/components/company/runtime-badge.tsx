"use client";

import { AlertTriangle, Cpu, FlaskConical } from "lucide-react";
import Link from "next/link";
import { useCompany } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * Says plainly whether the AI employees are really working or the dashboard is
 * running on simulated activity. The difference matters too much to hide.
 */
export function RuntimeBadge({ className }: { className?: string }) {
  const mode = useCompany((s) => s.mode);
  const runtime = useCompany((s) => s.runtime);

  if (mode === "unknown") return null;

  if (mode === "live" && runtime?.transport === "stub") {
    return (
      <Link
        href="/settings"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md bg-warn/10 px-2 py-0.5 transition-colors hover:bg-warn/20",
          className,
        )}
        title="FRIDAY_TEST_TRANSPORT が有効です。モデル呼び出しのみ模擬されています。"
      >
        <FlaskConical className="h-3 w-3 text-warn" strokeWidth={2} />
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-warn">
          Stub
        </span>
      </Link>
    );
  }

  if (mode === "live") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md bg-live/10 px-2 py-0.5",
          className,
        )}
        title={`Claude API · ${runtime?.model ?? ""}`}
      >
        <Cpu className="h-3 w-3 text-live" strokeWidth={2} />
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-live">Live</span>
      </span>
    );
  }

  return (
    <Link
      href="/settings"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md bg-warn/10 px-2 py-0.5 transition-colors hover:bg-warn/20",
        className,
      )}
      title="ANTHROPIC_API_KEY を設定すると、AI社員が実際に動作します"
    >
      <FlaskConical className="h-3 w-3 text-warn" strokeWidth={2} />
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-warn">Demo</span>
    </Link>
  );
}

/** Shown when a live call fails, so a misconfiguration is never silent. */
export function LiveErrorBanner() {
  const error = useCompany((s) => s.liveError);
  const clear = useCompany((s) => s.setLiveError);

  if (!error) return null;

  return (
    <div className="border-b border-danger/25 bg-danger/[0.07]">
      <div className="mx-auto flex w-full max-w-[1800px] items-center gap-3 px-4 py-2 lg:px-7 2xl:max-w-[2100px]">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" strokeWidth={1.75} />
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-danger">
          Agent error
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-ink-muted">{error}</span>
        <Link
          href="/settings"
          className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-danger hover:underline"
        >
          Settings
        </Link>
        <button
          onClick={() => clear(undefined)}
          aria-label="Dismiss"
          className="shrink-0 rounded-md px-1.5 py-1 text-[10px] text-ink-ghost transition-colors hover:bg-white/5 hover:text-ink-faint"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
