import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { stateful } from "@/server/runtime/stateful";
import { mutate, read } from "@/server/runtime/store";
import { agentScopes, agentTokenSource, authorise } from "@/server/vp/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The key for the CEO's own agent, minted here rather than in a terminal.
 *
 * The first design put this in an environment variable, which asked the CEO
 * to run `openssl`, paste the result into a hosting dashboard and redeploy —
 * three steps in a tool he does not use, for a value that dashboard will
 * never show him again. So the app makes it: one button, shown once, and
 * replaceable when it is lost.
 *
 * Minting is a claim: the first one is open, and after that a valid token is
 * required to mint another. That is the standard shape, and it is worth being
 * plain about what it does and does not fix — it does not lower anything,
 * because the dashboard's own API routes are already unauthenticated, but it
 * does mean the company should not sit on a public URL unclaimed.
 */

function newToken(): string {
  return randomBytes(32).toString("hex");
}

async function handlePOST(request: Request) {
  const existing = read((s) => s.agentAccess?.token ?? "");
  const fromEnv = agentTokenSource() === "env";

  if (fromEnv) {
    return NextResponse.json(
      {
        error:
          "FRIDAY_AGENT_TOKEN が環境変数で設定されているため、こちらからは発行できません。" +
          "画面から管理したい場合は、その環境変数を削除して再デプロイしてください。",
      },
      { status: 409 },
    );
  }

  // Once claimed, replacing the key requires holding the current one.
  if (existing) {
    const grant = authorise(request);
    if (!grant.ok) {
      return NextResponse.json(
        {
          error:
            "すでに発行済みです。作り直すには現在のトークンが必要です" +
            "（Authorization: Bearer <現在のトークン>）。紛失した場合は、" +
            "Vercel の環境変数に FRIDAY_AGENT_TOKEN を設定すればそちらが優先されます。",
        },
        { status: 401 },
      );
    }
  }

  let label = "FRIDAY（副社長）";
  try {
    const body = (await request.json()) as { label?: string };
    if (typeof body.label === "string" && body.label.trim()) {
      label = body.label.trim().slice(0, 60);
    }
  } catch {
    // No body is fine; the default label stands.
  }

  const token = newToken();
  mutate((s) => {
    s.agentAccess = { token, createdAt: Date.now(), label };
  });

  // The only time the value is ever returned. A second read would make this
  // endpoint a way to steal the key rather than a way to create one.
  return NextResponse.json({
    token,
    label,
    scopes: agentScopes(),
    replaced: Boolean(existing),
  });
}

/** Whether access exists, and where it came from. Never the value. */
async function handleGET() {
  const source = agentTokenSource();
  return NextResponse.json({
    configured: source !== "none",
    source,
    scopes: source === "none" ? [] : agentScopes(),
    createdAt: read((s) => s.agentAccess?.createdAt ?? null),
    label: read((s) => s.agentAccess?.label ?? null),
  });
}

export const POST = stateful(handlePOST);
export const GET = stateful(handleGET);
