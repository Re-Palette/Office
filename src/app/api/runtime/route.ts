import { NextResponse } from "next/server";
import { publicStatus } from "@/server/runtime/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tells the dashboard whether AI employees can actually run. */
export async function GET() {
  return NextResponse.json(publicStatus());
}
