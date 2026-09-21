"use client";

import { X } from "lucide-react";
import { useCompany } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ActivityFeed } from "@/components/company/activity-feed";
import { CeoInbox } from "@/components/company/ceo-inbox";
import { ApprovalQueue } from "@/components/company/ceo-action";
import { CeoChat } from "@/components/company/ceo-chat";
import { Notifications } from "@/components/company/notifications";
import { LiveDot } from "@/components/ui/primitives";

export function RightPanel() {
  const open = useCompany((s) => s.rightPanelOpen);
  const toggle = useCompany((s) => s.toggleRightPanel);
  const activity = useCompany((s) => s.activity);
  const approvals = useCompany((s) => s.approvals);
  const notifications = useCompany((s) => s.notifications);
  const tab = useCompany((s) => s.panelTab);
  const setTab = useCompany((s) => s.setPanelTab);

  const pending = approvals.filter((a) => a.status === "pending" || a.status === "reviewing").length;
  const unread = notifications.filter((n) => !n.read).length;

  const tabs: { id: typeof tab; label: string; count?: number }[] = [
    { id: "activity", label: "LIVE" },
    { id: "inbox", label: "INBOX", count: pending },
    { id: "chat", label: "CHAT" },
    { id: "alerts", label: "ALERTS", count: unread },
  ];

  if (!open) return null;

  return (
    <>
      <button
        aria-label="Close panel"
        onClick={toggle}
        className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm xl:hidden"
      />
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex w-[min(340px,88vw)] flex-col border-l border-hairline bg-canvas backdrop-blur-2xl",
          "xl:static xl:z-auto xl:w-[340px] xl:bg-surface/70 2xl:w-[380px]",
        )}
      >
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-hairline px-3">
        <div className="flex flex-1 items-center gap-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
                tab === t.id
                  ? "bg-white/[0.06] text-ink"
                  : "text-ink-ghost hover:bg-white/[0.03] hover:text-ink-faint",
              )}
            >
              {t.id === "activity" && tab === "activity" && <LiveDot />}
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span
                  className={cn(
                    "num rounded px-1 text-[9px]",
                    tab === t.id ? "bg-warn/15 text-warn" : "bg-white/5 text-ink-faint",
                  )}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={toggle}
          aria-label="Close panel"
          className="rounded-lg p-1.5 text-ink-ghost transition-colors hover:bg-white/5 hover:text-ink xl:hidden"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>

      {tab === "chat" ? (
        <CeoChat />
      ) : (
        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
          {tab === "activity" && (
            <>
              <div className="border-b border-hairline px-4 py-2.5">
                <span className="label">Live Activity</span>
                <p className="mt-0.5 text-[10px] text-ink-ghost">
                  AI社員の行動をリアルタイムに記録しています
                </p>
              </div>
              <ActivityFeed events={activity} dense limit={60} />
            </>
          )}
          {tab === "inbox" && (
            <>
              <div className="border-b border-hairline px-4 py-2.5">
                <span className="label">Approval Queue</span>
                <p className="mt-0.5 text-[10px] text-ink-ghost">
                  あなたが判断しないとAI会社が進まないものだけ
                </p>
              </div>
              <ApprovalQueue limit={8} />
              <div className="border-y border-hairline px-4 py-2.5">
                <span className="label">Full requests</span>
              </div>
              <CeoInbox compact />
            </>
          )}
          {tab === "alerts" && <Notifications />}
        </div>
      )}
      </aside>
    </>
  );
}
