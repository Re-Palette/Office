import { NextResponse } from "next/server";
import { diagnoseSupabase } from "@/server/runtime/diagnose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Setup check, as a page you open.
 *
 * The alternative was asking someone to run curl with their own copy of a
 * secret key and read a status code — so this does it server-side and says
 * what is wrong in a sentence. It reports the host, the kind of key and what
 * the server answered; it never echoes the key itself.
 */
export async function GET() {
  return NextResponse.json(await diagnoseSupabase(), {
    headers: { "Cache-Control": "no-store" },
  });
}
