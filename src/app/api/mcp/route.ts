import { NextResponse } from "next/server";
import { stateful } from "@/server/runtime/stateful";
import { background } from "@/server/runtime/background";
import { getConfig } from "@/server/runtime/config";
import { authorise } from "@/server/vp/auth";
import { toolsFor } from "@/server/vp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Agent runs are slow; the same ceiling the other agent routes use.
export const maxDuration = 300;

/**
 * POST /api/mcp — the company, as tools an outside agent can hold.
 *
 * This is the Model Context Protocol over HTTP, which is what makes the
 * vice-president arrangement work without either side writing glue: the CEO's
 * own agent adds this one URL and gets the company's tools in its own tool
 * list, so "how are we doing" and "tell the company to…" are things it can
 * simply do.
 *
 * Written against the protocol directly rather than through the SDK, for the
 * same reason the model providers are: it is a small, stable JSON-RPC surface,
 * and this keeps the dependency list empty and the auth in one place.
 *
 * Every call is bearer-authenticated and scoped. The approval gate is
 * unchanged — an agent holding operate scope can spend the company's
 * allowance and queue decisions, and still cannot send an email.
 */

const PROTOCOL = "2025-06-18";

interface Rpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function result(id: Rpc["id"], value: unknown) {
  return { jsonrpc: "2.0", id, result: value };
}

function failure(id: Rpc["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** MCP returns a tool's outcome as content, with errors in-band. */
function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    isError,
  };
}

async function handlePOST(request: Request) {
  const grant = authorise(request);
  if (!grant.ok) {
    return NextResponse.json(
      { error: grant.reason },
      {
        status: grant.status,
        // Tells a conforming client this is an auth problem, not a bad request.
        headers: grant.status === 401 ? { "WWW-Authenticate": "Bearer" } : {},
      },
    );
  }

  let rpc: Rpc;
  try {
    rpc = (await request.json()) as Rpc;
  } catch {
    return NextResponse.json(failure(null, -32700, "Parse error"), { status: 400 });
  }

  const id = rpc.id ?? null;

  switch (rpc.method) {
    case "initialize":
      return NextResponse.json(
        result(id, {
          protocolVersion: PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "friday-ai-company", version: "1.0.0" },
          instructions:
            "ARQOのAI会社（48名のAI社員）を操作します。" +
            "状況を聞かれたら company_status から始めてください。" +
            "外部への送信・公開・支出・本番反映はすべてCEOの承認が必要で、" +
            "instruct_company からは実行できません（承認待ちとして積まれます）。" +
            (toolsFor(grant).some((t) => t.name === "decide_approval")
              ? "decide_approval はCEOの明確な指示があるときだけ使ってください。"
              : "承認の実行権限はありません。承認はCEOがダッシュボードで行います。"),
        }),
      );

    // Notifications carry no id and expect no result.
    case "notifications/initialized":
    case "notifications/cancelled":
      return new NextResponse(null, { status: 202 });

    case "ping":
      return NextResponse.json(result(id, {}));

    case "tools/list":
      return NextResponse.json(
        result(id, {
          tools: toolsFor(grant).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.schema,
          })),
        }),
      );

    case "tools/call": {
      const name = String(rpc.params?.name ?? "");
      const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>;

      const tool = toolsFor(grant).find((t) => t.name === name);
      if (!tool) {
        // Distinguish "no such tool" from "not granted to you", because the
        // second is a configuration answer and the first is a typo.
        const exists = (await import("@/server/vp/tools")).VP_TOOLS.some((t) => t.name === name);
        return NextResponse.json(
          result(
            id,
            toolResult(
              exists
                ? {
                    error: `${name} はこのトークンの権限では使えません。`,
                    hint: "FRIDAY_AGENT_SCOPES に必要なスコープを追加してください。",
                  }
                : { error: `不明なツールです: ${name}` },
              true,
            ),
          ),
        );
      }

      if (getConfig().mode === "demo" && tool.scope !== "read") {
        return NextResponse.json(
          result(
            id,
            toolResult(
              {
                error:
                  "APIキーが未設定のため、AI社員は実行されません。読み取りだけ可能です。",
              },
              true,
            ),
          ),
        );
      }

      try {
        const value = (await tool.run(args, grant)) as Record<string, unknown> | unknown;

        // A tool that started an agent run hands the promise back rather than
        // dropping it: on serverless the instance freezes at the response, so
        // without this the work the CEO just asked for would stop mid-flight.
        if (value && typeof value === "object" && "handOff" in (value as object)) {
          const { handOff, ...rest } = value as Record<string, unknown>;
          if (handOff instanceof Promise) {
            background(`mcp:${name}`, () => handOff);
          }
          return NextResponse.json(result(id, toolResult(rest)));
        }

        return NextResponse.json(result(id, toolResult(value)));
      } catch (error) {
        return NextResponse.json(
          result(id, toolResult({ error: (error as Error).message }, true)),
        );
      }
    }

    default:
      return NextResponse.json(failure(id, -32601, `Method not found: ${rpc.method}`));
  }
}

/**
 * A GET is how a person checks the endpoint is alive, and how some clients
 * probe for the streaming transport. Neither should look like a crash.
 */
async function handleGET(request: Request) {
  const grant = authorise(request);
  if (!grant.ok) {
    return NextResponse.json({ error: grant.reason }, { status: grant.status });
  }
  return NextResponse.json({
    server: "friday-ai-company",
    protocolVersion: PROTOCOL,
    transport: "POST JSON-RPC to this URL",
    actor: grant.actor,
    scopes: grant.scopes,
    tools: toolsFor(grant).map((t) => t.name),
  });
}

export const POST = stateful(handlePOST);
export const GET = stateful(handleGET);
