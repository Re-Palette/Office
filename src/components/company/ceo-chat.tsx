"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, CornerDownLeft, Sparkles } from "lucide-react";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { CHAT_SUGGESTIONS } from "@/lib/engine/chat";
import { useCompany } from "@/lib/store";
import { formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Avatar, Button } from "@/components/ui/primitives";

export function CeoChat({ className }: { className?: string }) {
  const chat = useCompany((s) => s.chat);
  const sendChat = useCompany((s) => s.sendChat);
  const [value, setValue] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.length]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    sendChat(trimmed);
    setValue("");
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="scroll-slim flex-1 overflow-y-auto px-4 py-4">
        {chat.length === 0 ? (
          <div className="flex h-full flex-col justify-center">
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent-soft ring-1 ring-inset ring-accent/20">
                <Sparkles className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <div>
                <p className="text-sm font-medium text-ink">会社全体に話しかける</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-faint">
                  COOが受け取り、各部署のAI社員へ展開します。
                </p>
              </div>
            </div>

            <div className="mt-2 space-y-1.5">
              {CHAT_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendChat(s)}
                  className="group flex w-full items-center justify-between gap-2 rounded-lg border border-hairline bg-white/[0.02] px-3 py-2 text-left text-xs text-ink-muted transition-colors hover:border-accent-line hover:bg-accent/[0.06] hover:text-ink"
                >
                  <span className="truncate">{s}</span>
                  <ArrowRight
                    className="h-3 w-3 shrink-0 text-ink-ghost transition-colors group-hover:text-accent-soft"
                    strokeWidth={1.75}
                  />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {chat.map((m) => {
              const agent = m.agentId ? AGENTS_BY_ID[m.agentId] : undefined;

              if (m.role === "ceo") {
                return (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    className="flex justify-end"
                  >
                    <div className="max-w-[86%] rounded-xl rounded-br-sm bg-accent/15 px-3 py-2 ring-1 ring-inset ring-accent/25">
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink">
                        {m.text}
                      </p>
                      <span className="num mt-1 block text-right text-[9px] text-ink-ghost">
                        {formatTime(m.at)}
                      </span>
                    </div>
                  </motion.div>
                );
              }

              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.1 }}
                  className="flex gap-2.5"
                >
                  {agent && <Avatar name={agent.name} accent={agent.accent} size="sm" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[11px] font-medium text-ink">
                        {agent?.role ?? "COO"}
                      </span>
                      <span className="num text-[9px] text-ink-ghost">{formatTime(m.at)}</span>
                    </div>

                    {m.routing && m.routing.length > 0 && (
                      <div className="mt-1.5 space-y-1 rounded-lg border border-hairline bg-white/[0.02] px-2.5 py-2">
                        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-ghost">
                          Routing
                        </span>
                        {m.routing.map((r, i) => {
                          const ra = AGENTS_BY_ID[r.agentId];
                          return (
                            <div key={`${r.agentId}-${i}`} className="flex items-center gap-1.5">
                              <span
                                className="h-1 w-1 shrink-0 rounded-full"
                                style={{ background: ra?.accent ?? "#6B7079" }}
                              />
                              <span className="shrink-0 text-[10px] font-medium text-ink-muted">
                                {ra?.role ?? r.agentId}
                              </span>
                              <span className="truncate text-[10px] text-ink-ghost">{r.note}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-ink-muted">
                      {m.text}
                    </p>
                  </div>
                </motion.div>
              );
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <form onSubmit={submit} className="border-t border-hairline p-3">
        <div className="relative">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="COOに指示・質問する…"
            aria-label="Message the company"
            className="h-9 w-full rounded-lg border border-hairline bg-white/[0.03] pl-3 pr-9 text-xs text-ink placeholder:text-ink-ghost focus:border-accent-line focus:outline-none"
          />
          <Button
            type="submit"
            variant="ghost"
            size="xs"
            aria-label="Send"
            className="absolute right-1 top-1/2 -translate-y-1/2 px-1.5"
            disabled={!value.trim()}
          >
            <CornerDownLeft className="h-3 w-3" strokeWidth={2} />
          </Button>
        </div>
        <p className="mt-1.5 px-0.5 text-[10px] text-ink-ghost">
          CEO → COO → Departments → Employees の順で処理されます。
        </p>
      </form>
    </div>
  );
}

export function ChatTimestamp({ at }: { at: number }) {
  return <span className="num text-[9px] text-ink-ghost">{formatTime(at)}</span>;
}
