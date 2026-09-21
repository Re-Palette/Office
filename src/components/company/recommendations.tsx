"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, MessageSquare, X } from "lucide-react";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { useCompany } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Avatar, Button, Empty } from "@/components/ui/primitives";

export function Recommendations({ onAsk }: { onAsk?: (headline: string) => void }) {
  const recommendations = useCompany((s) => s.recommendations);
  const decide = useCompany((s) => s.decideRecommendation);

  const open = recommendations.filter((r) => r.status === "open");

  if (open.length === 0) {
    return <Empty title="新しい提案はありません" hint="AI社員は状況が変われば再提案します" />;
  }

  return (
    <div className="divide-y divide-hairline">
      <AnimatePresence initial={false}>
        {open.map((rec) => {
          const agent = AGENTS_BY_ID[rec.fromAgent];
          return (
            <motion.article
              key={rec.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, height: 0, overflow: "hidden" }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="px-5 py-4"
            >
              <div className="flex items-start gap-3">
                {agent && <Avatar name={agent.name} accent={agent.accent} size="md" />}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold text-ink">
                      {agent?.role ?? rec.fromAgent}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-ghost">
                      proposes
                    </span>
                    <span className="ml-auto flex items-center gap-1.5">
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-ghost">
                        confidence
                      </span>
                      <span
                        className={cn(
                          "num text-[11px] font-semibold",
                          rec.confidence >= 85
                            ? "text-live"
                            : rec.confidence >= 70
                              ? "text-accent-soft"
                              : "text-warn",
                        )}
                      >
                        {rec.confidence}%
                      </span>
                    </span>
                  </div>

                  <p className="mt-1.5 text-[13px] font-medium leading-snug text-ink">
                    「{rec.headline}」
                  </p>

                  <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{rec.rationale}</p>

                  <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
                    {rec.evidence.map((e) => (
                      <div key={e.label} className="flex items-baseline gap-1.5">
                        <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-ghost">
                          {e.label}
                        </dt>
                        <dd className="num text-[11px] font-medium text-ink-muted">{e.value}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <Button variant="success" size="xs" onClick={() => decide(rec.id, "approved")}>
                      <Check className="h-3 w-3" strokeWidth={2.25} />
                      Approve
                    </Button>
                    <Button variant="danger" size="xs" onClick={() => decide(rec.id, "rejected")}>
                      <X className="h-3 w-3" strokeWidth={2.25} />
                      Reject
                    </Button>
                    <Button variant="ghost" size="xs" onClick={() => onAsk?.(rec.headline)}>
                      <MessageSquare className="h-3 w-3" strokeWidth={1.75} />
                      Ask AI
                    </Button>
                  </div>
                </div>
              </div>
            </motion.article>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
