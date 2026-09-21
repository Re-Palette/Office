"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { FileText, Search } from "lucide-react";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { KNOWLEDGE, KNOWLEDGE_CATEGORIES } from "@/lib/company/knowledge";
import { useCompany } from "@/lib/store";
import { formatRelative } from "@/lib/time";
import type { KnowledgeDoc } from "@/lib/types";
import { Avatar, Chip, FilterTabs, Panel, PanelHeader } from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/page-header";

type Filter = "all" | KnowledgeDoc["category"];

export default function KnowledgePage() {
  const now = useCompany((s) => s.now);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return KNOWLEDGE.filter((d) => (filter === "all" ? true : d.category === filter))
      .filter((d) =>
        q ? `${d.title} ${d.excerpt} ${d.tags.join(" ")}`.toLowerCase().includes(q) : true,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [filter, query]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<span className="label">Company Memory</span>}
        title="Knowledge Center"
        description="AI社員が判断のために参照する、会社のすべての知識。ここに書かれたことが会社の前提になります。"
        actions={
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-ghost"
              strokeWidth={1.75}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="知識を検索"
              aria-label="Search knowledge"
              className="h-9 w-[240px] rounded-lg border border-hairline bg-white/[0.03] pl-9 pr-3 text-xs text-ink placeholder:text-ink-ghost focus:border-accent-line focus:outline-none"
            />
          </div>
        }
      />

      <Panel className="px-4 py-2.5">
        <FilterTabs<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "All", count: KNOWLEDGE.length },
            ...KNOWLEDGE_CATEGORIES.map((c) => ({
              id: c.id as Filter,
              label: c.label,
              count: KNOWLEDGE.filter((d) => d.category === c.id).length,
            })),
          ]}
        />
      </Panel>

      {filtered.length === 0 ? (
        <Panel className="px-5 py-14 text-center">
          <p className="text-sm text-ink-muted">該当するドキュメントがありません</p>
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((doc, i) => {
            const owner = AGENTS_BY_ID[doc.owner];
            return (
              <motion.article
                key={doc.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: Math.min(i * 0.02, 0.25) }}
                className="group flex flex-col rounded-2xl border border-hairline bg-surface/70 p-5 transition-colors hover:border-hairline-strong hover:bg-surface-hover/40"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-ink-faint">
                    <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[13px] font-medium leading-snug text-ink">{doc.title}</h3>
                    <Chip className="mt-1.5">
                      {KNOWLEDGE_CATEGORIES.find((c) => c.id === doc.category)?.label ??
                        doc.category}
                    </Chip>
                  </div>
                </div>

                <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">{doc.excerpt}</p>

                <div className="mt-3 flex flex-wrap gap-1">
                  {doc.tags.map((t) => (
                    <span key={t} className="font-mono text-[9px] text-ink-ghost">
                      #{t}
                    </span>
                  ))}
                </div>

                <div className="mt-auto flex items-center gap-2 border-t border-hairline pt-3.5">
                  {owner && (
                    <Link
                      href={`/employees/${owner.id}`}
                      className="flex min-w-0 items-center gap-1.5"
                    >
                      <Avatar name={owner.name} accent={owner.accent} size="xs" />
                      <span className="truncate text-[10px] text-ink-faint transition-colors hover:text-accent-soft">
                        {owner.role}
                      </span>
                    </Link>
                  )}
                  <span className="num ml-auto shrink-0 text-[10px] text-ink-ghost">
                    {formatRelative(doc.updatedAt, now)}
                  </span>
                </div>
              </motion.article>
            );
          })}
        </div>
      )}

      <Panel className="overflow-hidden">
        <PanelHeader title="Retrieval" hint="AI社員はここから検索します" />
        <p className="px-5 py-4 text-xs leading-relaxed text-ink-muted">
          各AI社員は <code className="font-mono text-[11px] text-accent-soft">file_search</code> /
          <code className="font-mono text-[11px] text-accent-soft"> database</code>{" "}
          ツール経由でこのKnowledge Centerを検索します。CEO Instructions と Brand Guidelines
          は、すべての社員のsystem promptへ自動的に注入されます。
        </p>
      </Panel>
    </div>
  );
}
