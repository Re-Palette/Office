import "server-only";

import { SEED_REPORTS } from "@/lib/company/report-seed";
import type { Report } from "@/lib/types";
import { mutate, read } from "@/server/runtime/store";

/**
 * Where a report is looked up when its PDF is opened.
 *
 * This used to be an in-memory Map with a note saying a later phase would
 * swap it for a database. That phase never came, and on serverless the Map is
 * worse than a placeholder: the instance that wrote the report is almost never
 * the instance asked for its PDF, so every report an AI employee actually
 * wrote opened as "Report not found" and told the CEO to regenerate it — which
 * produced another report that also would not open.
 *
 * The durable copy already existed. `submit_report` writes the whole report,
 * content included, into the company state, which is what Supabase holds and
 * what the dashboard renders from. So that is what is read here, and the Map
 * is kept only as a same-instance fast path.
 *
 * Callers must have the state loaded. Every route that reaches this is wrapped
 * in `stateful`, which is what makes it work on a cold instance.
 */

const runtime = new Map<string, Report>();

export function getReport(id: string): Report | undefined {
  // Persisted first: it is the copy that survives, and it carries the CEO's
  // review decision, which the in-memory one may predate.
  const persisted = read((s) => s.reports.find((r) => r.id === id));
  if (persisted) return persisted;

  return runtime.get(id) ?? SEED_REPORTS.find((r) => r.id === id);
}

/**
 * Records a report so its PDF can be rendered later.
 *
 * Writes to both: the state, because that is what outlives this instance, and
 * the Map, because within one request the state may not have flushed yet. The
 * state write is an upsert, so a report already stored by the agent that
 * submitted it is updated rather than duplicated.
 */
export function putReport(report: Report): void {
  runtime.set(report.id, report);
  if (runtime.size > 200) {
    const oldest = [...runtime.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) runtime.delete(oldest.id);
  }

  mutate((s) => {
    const index = s.reports.findIndex((r) => r.id === report.id);
    if (index >= 0) s.reports[index] = report;
    else s.reports = [report, ...s.reports];
  });
}

export function listReportIds(): string[] {
  const persisted = read((s) => s.reports.map((r) => r.id));
  return [...new Set([...SEED_REPORTS.map((r) => r.id), ...persisted, ...runtime.keys()])];
}

/** Test seam: simulates a cold instance that never saw the report written. */
export function __clearRuntimeForTesting(): void {
  runtime.clear();
}
