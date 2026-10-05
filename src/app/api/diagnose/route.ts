import { NextResponse } from "next/server";
import { diagnoseAccess, diagnoseModel, diagnoseSupabase } from "@/server/runtime/diagnose";
import { quotaStatus } from "@/lib/ai/budget";
import { autonomyStatus } from "@/server/autonomy";
import { workRemaining } from "@/server/runtime/tick";
import { jobHistory } from "@/server/scheduler";
import { read } from "@/server/runtime/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Setup check, as a page you open.
 *
 * The alternative was asking someone to run curl with their own copy of a
 * secret key and read a status code — so this does it server-side and says
 * what is wrong in a sentence. It covers both credentials the company needs:
 * the model key (and which models it can actually reach, since free-tier
 * availability moves) and the database. It reports hosts, key kinds and what
 * each server answered; it never echoes a key itself.
 */
export async function GET() {
  // Both checks are independent, so neither waits on the other.
  const [supabase, model] = await Promise.all([diagnoseSupabase(), diagnoseModel()]);

  // Whether the company is actually working, and what is holding it if not.
  // Here because the CEO cannot read the server's logs: without this, "is it
  // running while I am not looking?" has no answer he can get for himself.
  const chain = read((s) => s.tick);
  const held = jobHistory()
    .filter((j) => j.retryAt !== undefined)
    .map((j) => ({
      job: j.id,
      resumesIn: `${Math.max(0, Math.ceil(((j.retryAt ?? 0) - Date.now()) / 1000))}秒後`,
      why: j.detail,
    }));

  return NextResponse.json(
    {
      model,
      supabase,
      access: diagnoseAccess(),
      work: {
        allowance: quotaStatus(),
        autonomy: autonomyStatus(),
        remaining: workRemaining(),
        // The background chain is what keeps working with the dashboard
        // closed, so its absence is the thing worth seeing.
        background: process.env.CRON_SECRET?.trim()
          ? {
              enabled: true,
              chainsToday: chain?.chains ?? 0,
              note: "ダッシュボードを閉じていても作業が続きます。",
            }
          : {
              enabled: false,
              chainsToday: 0,
              note:
                "CRON_SECRET が未設定です。設定するまで、ダッシュボードを閉じている間は" +
                "1日2回の定期実行しか動きません。",
            },
        heldJobs: held,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
