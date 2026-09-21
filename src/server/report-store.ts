import "server-only";

import { SEED_REPORTS } from "@/lib/company/report-seed";
import type { Report } from "@/lib/types";

/**
 * Server-side report registry.
 *
 * Seeded reports are known at build time. Reports generated in the browser are
 * pushed here by `POST /api/reports` so that `/reports/{id}/pdf` can render a
 * real PDF from the same content the dashboard is showing.
 *
 * This is deliberately in-memory: Phase 3 swaps the two functions below for
 * Supabase reads and writes, and nothing else changes. It means a server
 * restart forgets runtime-generated reports — seeded ones always resolve.
 */

const runtime = new Map<string, Report>();

export function getReport(id: string): Report | undefined {
  return runtime.get(id) ?? SEED_REPORTS.find((r) => r.id === id);
}

export function putReport(report: Report): void {
  runtime.set(report.id, report);
  // Keep the registry from growing without bound in a long-lived process.
  if (runtime.size > 200) {
    const oldest = [...runtime.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) runtime.delete(oldest.id);
  }
}

export function listReportIds(): string[] {
  return [...new Set([...SEED_REPORTS.map((r) => r.id), ...runtime.keys()])];
}
