import "server-only";

import { AGENTS_BY_ID } from "@/lib/company/agents";
import type { Block, ModelRequest, ModelResponse, Provider } from "@/lib/ai/types";

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
  content: Block[];
}

let counter = 0;
const id = () => `stub-${(counter++).toString(36)}`;

function turnsFor(
  role: string,
  canDelegate: boolean,
  canReport: boolean,
  canWriteNote: boolean,
): Turn[] {
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
  } else if (canWriteNote) {
    // So the daily note job can be seen working before any tokens are spent.
    turns.push({
      content: [
        {
          type: "tool_use",
          id: id(),
          name: "write_note_article",
          input: {
            title: "AI社員が書いた記事のサンプル（stub transport）",
            body: [
              "## これはサンプルです",
              "",
              "FRIDAY_TEST_TRANSPORT=1 が有効なため、この記事はモデルではなく",
              "定型のスタブが生成しています。保存・ファイル出力・毎日の実行・",
              "ダッシュボードでの表示は、すべて本物と同じ経路を通っています。",
              "",
              "## 本物の記事にするには",
              "",
              "- `.env.local` から `FRIDAY_TEST_TRANSPORT` を外す",
              "- `GEMINI_API_KEY` を設定する",
              "- `npm run dev` を再起動する",
              "",
              "以降、Content AI が会社の実際の動きを読んで記事を書きます。",
              "投稿するのはCEOです。note には公式の投稿APIがないため、",
              "この画面から本文をコピーして貼り付けてください。",
            ].join("\n"),
            tags: ["AI", "note", "stub"],
            reason: "stub transport による動作確認用のサンプル記事です。",
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
            risks: [{ level: "low", text: "本番では GEMINI_API_KEY を設定してください。" }],
            decisions: [],
            nextActions: ["GEMINI_API_KEY を設定して実際のAI社員を動かす"],
          },
        },
      ],
    });
  }

  turns.push({
    content: [
      {
        type: "text",
        text: `${role} の作業が完了しました（stub transport）。実際の分析を行うには GEMINI_API_KEY を設定してください。`,
      },
    ],
  });

  return turns;
}

/**
 * The scripted provider.
 *
 * Shaped to the same `Provider` interface as Gemini, so the loop cannot tell
 * them apart and the self-test exercises the real code path.
 */
export function createStubProvider(): Provider {
  return {
    id: "stub",

    async send(request: ModelRequest): Promise<ModelResponse> {
      const role = request.system.match(/\[ROLE\] ([^—\n]+)/)?.[1]?.trim() ?? "COO";

      const toolNames = new Set(request.tools.map((t) => t.name));
      const canDelegate = toolNames.has("delegate");
      const canReport = toolNames.has("submit_report");
      const canWriteNote = toolNames.has("write_note_article");

      // The turn index is derived from the conversation itself, so every run
      // starts from the beginning of the script rather than sharing a cursor.
      const index = request.messages.filter((m) => m.role === "assistant").length;

      const turns = turnsFor(role, canDelegate, canReport, canWriteNote);
      const content = turns[Math.min(index, turns.length - 1)].content;
      const hasToolUse = content.some((b) => b.type === "tool_use");

      // A beat, so the dashboard visibly shows work in flight.
      await new Promise((resolve) => setTimeout(resolve, 450));

      return {
        blocks: content,
        stopReason: hasToolUse ? "tool_use" : "end",
        usage: { inputTokens: 1500, outputTokens: 400, cachedTokens: 0, thoughtTokens: 0 },
      };
    },
  };
}

export const STUB_AGENT_NAMES = Object.keys(AGENTS_BY_ID);
