import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { AGENTS_BY_ID } from "@/lib/company/agents";

/**
 * A scripted stand-in for the model, enabled with FRIDAY_TEST_TRANSPORT=1.
 *
 * Everything around it is the real thing — the loop, the tools, the company
 * state, the approval gate, the PDF — only the model call is canned. It exists
 * so the whole pipeline can be exercised end to end without spending tokens,
 * and so a misconfigured deployment can be told apart from a broken one.
 *
 * It is never used when the transport is set to the real API.
 */

interface Turn {
  content: Record<string, unknown>[];
}

let counter = 0;
const id = () => `stub-${(counter++).toString(36)}`;

function turnsFor(role: string, canDelegate: boolean, canReport: boolean): Turn[] {
  const turns: Turn[] = [
    {
      content: [
        { type: "text", text: `${role} が作業を開始します。` },
        {
          type: "tool_use",
          id: id(),
          name: "log_progress",
          input: { message: `${role} が会社の状況を確認しています`, detail: "stub transport" },
        },
        {
          type: "tool_use",
          id: id(),
          name: "get_company_data",
          input: { scope: "overview" },
        },
      ],
    },
  ];

  if (canDelegate) {
    turns.push({
      content: [
        { type: "text", text: "調査をResearch Directorへ委譲します。" },
        {
          type: "tool_use",
          id: id(),
          name: "delegate",
          input: {
            agentId: "research_director",
            objective: "現在の市場状況を3点にまとめて報告してください。",
          },
        },
      ],
    });
    turns.push({
      content: [
        { type: "text", text: "外部への送信が必要なため、CEOの承認を求めます。" },
        {
          type: "tool_use",
          id: id(),
          name: "request_ceo_approval",
          input: {
            title: "外部送信の承認",
            summary: "調査結果をもとに外部へ連絡します（stub transport による模擬）。",
            impact: "承認すると外部へ送信されます。取り消せません。",
            risk: "high",
            priority: "urgent",
            kind: "email",
          },
        },
      ],
    });
  } else if (canReport) {
    turns.push({
      content: [
        {
          type: "tool_use",
          id: id(),
          name: "submit_report",
          input: {
            title: `${role} — Research Report (stub)`,
            type: "research",
            executiveSummary:
              "これは FRIDAY_TEST_TRANSPORT による模擬レポートです。モデル呼び出し以外の経路（ツール実行・会社データの読み取り・PDF生成・承認フロー）はすべて本物です。",
            keyMetrics: [{ label: "Stub run", value: "1" }],
            findings: ["stub transport のためモデルによる分析は行われていません"],
            risks: [{ level: "low", text: "本番では ANTHROPIC_API_KEY を設定してください。" }],
            decisions: [],
            nextActions: ["ANTHROPIC_API_KEY を設定して実際のAI社員を動かす"],
          },
        },
      ],
    });
  }

  turns.push({
    content: [
      {
        type: "text",
        text: `${role} の作業が完了しました（stub transport）。実際の分析を行うには ANTHROPIC_API_KEY を設定してください。`,
      },
    ],
  });

  return turns;
}

/** Matches the small surface of the SDK that the runner actually uses. */
export function createStubClient(): Anthropic {
  return {
    messages: {
      stream(params: Record<string, unknown>) {
        const system = Array.isArray(params.system)
          ? String((params.system[0] as { text?: string })?.text ?? "")
          : String(params.system ?? "");
        const role = system.match(/\[ROLE\] ([^—\n]+)/)?.[1]?.trim() ?? "COO";

        const toolNames = new Set(
          ((params.tools ?? []) as { name?: string }[]).map((t) => t.name).filter(Boolean),
        );
        const canDelegate = toolNames.has("delegate");
        const canReport = toolNames.has("submit_report");

        // The turn index is derived from the conversation itself, so every run
        // starts from the beginning of the script rather than sharing a cursor.
        const history = (params.messages ?? []) as { role?: string }[];
        const index = history.filter((m) => m.role === "assistant").length;

        const turns = turnsFor(role, canDelegate, canReport);
        const content = turns[Math.min(index, turns.length - 1)].content;
        const hasToolUse = content.some((b) => b.type === "tool_use");

        return {
          async finalMessage() {
            // A beat, so the dashboard visibly shows work in flight.
            await new Promise((resolve) => setTimeout(resolve, 450));
            return {
              content,
              stop_reason: hasToolUse ? "tool_use" : "end_turn",
              stop_details: null,
              usage: { input_tokens: 1500, output_tokens: 400 },
            };
          },
        };
      },
    },
  } as unknown as Anthropic;
}

export const STUB_AGENT_NAMES = Object.keys(AGENTS_BY_ID);
