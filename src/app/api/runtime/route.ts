import { NextResponse } from "next/server";
import { publicStatus } from "@/server/runtime/config";
import { stateful } from "@/server/runtime/stateful";
import { storageStatus } from "@/server/runtime/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tells the dashboard whether AI employees can actually run.
 *
 * It goes through the state loader rather than just reading configuration, so
 * `storage` reports whether the database actually answered — not merely that
 * the environment variables are present. A mistyped key would otherwise look
 * identical to a working one until work quietly stopped being saved.
 */
async function handleGET() {
  return NextResponse.json(publicStatus(storageStatus()), {
    headers: { "Cache-Control": "no-store" },
  });
}

export const GET = stateful(handleGET);
