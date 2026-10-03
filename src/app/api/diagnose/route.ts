import { NextResponse } from "next/server";
import { diagnoseGemini, diagnoseSupabase } from "@/server/runtime/diagnose";

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
  const [supabase, gemini] = await Promise.all([diagnoseSupabase(), diagnoseGemini()]);
  return NextResponse.json(
    { gemini, supabase },
    { headers: { "Cache-Control": "no-store" } },
  );
}
