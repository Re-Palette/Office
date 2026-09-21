import { AGENTS, AGENTS_BY_ID, DEPARTMENT_HEADS } from "@/lib/company/agents";
import { DEPARTMENTS } from "@/lib/company/departments";
import type { DepartmentId } from "@/lib/types";

/**
 * Mock orchestrator.
 *
 * Turns a CEO instruction into a delegation plan: the COO decomposes it,
 * the relevant departments pick it up, and the COO integrates the result
 * back into a single report for the CEO. Swapping this for a real Claude
 * call means replacing `planCommand` — nothing in the UI changes.
 */

export interface PlanStep {
  id: string;
  agentId: string;
  department: DepartmentId | "executive";
  action: string;
  detail: string;
  etaMinutes: number;
  dependsOn: string[];
}

export interface CommandPlan {
  id: string;
  input: string;
  objective: string;
  successCriteria: string[];
  steps: PlanStep[];
  departments: DepartmentId[];
  estimatedMinutes: number;
  needsApproval: boolean;
  approvalReason?: string;
}

const DEPARTMENT_KEYWORDS: Record<DepartmentId, string[]> = {
  finance: ["売上", "収益", "予算", "コスト", "費用", "利益", "投資", "資金", "価格", "revenue", "budget", "cost"],
  research: ["調査", "リサーチ", "市場", "競合", "トレンド", "分析", "動向", "事例", "research", "market"],
  marketing: ["マーケ", "認知", "sns", "投稿", "広告", "集客", "施策", "伸ば", "成長", "instagram", "コンテンツ", "発信"],
  sales: ["営業", "提携", "顧客", "リード", "商談", "パートナー", "販売", "契約", "売上", "受注", "sales"],
  engineering: ["開発", "実装", "コード", "バグ", "アプリ", "システム", "api", "デプロイ", "技術", "dev"],
  creative: ["デザイン", "lp", "ロゴ", "クリエイティブ", "ビジュアル", "写真", "動画", "コピー", "design"],
  operations: ["予定", "スケジュール", "資料", "記録", "議事", "リマインド", "整理", "会議"],
  strategy: ["戦略", "新規事業", "計画", "方針", "ロードマップ", "リソース", "組織", "strategy"],
};

const APPROVAL_KEYWORDS = [
  "送信", "送って", "公開", "投稿して", "デプロイ", "deploy", "支払", "契約", "購入", "本番",
];

/** Open-ended asks ("〜を考えて") always get evidence and framing behind them. */
const OPEN_ENDED = ["考えて", "提案", "出して", "まとめて", "どうすれば", "アイデア", "案を"];

function detectDepartments(input: string): DepartmentId[] {
  const lower = input.toLowerCase();
  const hits = DEPARTMENTS.map((d) => {
    const score = DEPARTMENT_KEYWORDS[d.id].reduce(
      (acc, kw) => (lower.includes(kw.toLowerCase()) ? acc + 1 : acc),
      0,
    );
    return { id: d.id, score };
  })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((d) => d.id);

  if (hits.length === 0) return ["research", "strategy"];

  // A single department rarely answers an open question well: pull in Research
  // for the evidence and Strategy for the framing before handing back to the COO.
  if (OPEN_ENDED.some((kw) => input.includes(kw))) {
    for (const support of ["research", "strategy"] as DepartmentId[]) {
      if (!hits.includes(support) && hits.length < 4) hits.push(support);
    }
  }

  return hits.slice(0, 4);
}

/** Picks the specialist inside a department whose skills best match the text. */
function pickSpecialist(department: DepartmentId, input: string): string {
  const lower = input.toLowerCase();
  const pool = AGENTS.filter(
    (a) => a.department === department && a.seniority === "specialist",
  );
  if (pool.length === 0) return DEPARTMENT_HEADS[department];

  const scored = pool.map((a) => {
    const text = `${a.role} ${a.mission} ${a.skills.join(" ")}`.toLowerCase();
    const score = text
      .split(/[\s|/]+/)
      .reduce((acc, token) => (token.length > 2 && lower.includes(token) ? acc + 1 : acc), 0);
    return { id: a.id, score, idle: a.status === "idle" ? 1 : 0 };
  });

  scored.sort((a, b) => b.score - a.score || b.idle - a.idle);
  return scored[0].id;
}

const DEPARTMENT_ACTION: Record<DepartmentId, { action: string; detail: string }> = {
  research: { action: "市場調査", detail: "一次情報を収集し、事実・解釈・示唆に分けて整理する" },
  marketing: { action: "施策立案", detail: "チャネル別の仮説と計測指標をセットで設計する" },
  sales: { action: "営業施策", detail: "対象候補を抽出し、接触順序と初手を設計する" },
  finance: { action: "収益シミュレーション", detail: "前提を明示した上で3シナリオの数値を試算する" },
  engineering: { action: "技術検討", detail: "実装可能性と必要工数を見積もり、最小構成を定義する" },
  creative: { action: "クリエイティブ制作", detail: "ブランドガイドラインに沿った表現案を制作する" },
  operations: { action: "運用設計", detail: "実行に必要な段取り・期日・記録の流れを整える" },
  strategy: { action: "戦略整理", detail: "前提・選択肢・推奨を分けて意思決定用に構造化する" },
};

let planCounter = 0;

export function planCommand(input: string): CommandPlan {
  const trimmed = input.trim();
  const departments = detectDepartments(trimmed);
  const id = `plan-${Date.now()}-${planCounter++}`;

  const needsApproval = APPROVAL_KEYWORDS.some((kw) =>
    trimmed.toLowerCase().includes(kw.toLowerCase()),
  );

  const steps: PlanStep[] = [
    {
      id: `${id}-0`,
      agentId: "coo",
      department: "executive",
      action: "指示を分解",
      detail: "目的と成功条件を定義し、担当部署を決定する",
      etaMinutes: 1,
      dependsOn: [],
    },
  ];

  departments.forEach((dept, i) => {
    const head = DEPARTMENT_HEADS[dept];
    const specialist = pickSpecialist(dept, trimmed);
    const meta = DEPARTMENT_ACTION[dept];

    steps.push({
      id: `${id}-d${i}-head`,
      agentId: head,
      department: dept,
      action: `${meta.action}の方針を決定`,
      detail: meta.detail,
      etaMinutes: 3 + i,
      dependsOn: [`${id}-0`],
    });

    if (specialist !== head) {
      steps.push({
        id: `${id}-d${i}-spec`,
        agentId: specialist,
        department: dept,
        action: `${meta.action}を実行`,
        detail: `${AGENTS_BY_ID[specialist]?.mission ?? ""}`,
        etaMinutes: 8 + i * 3,
        dependsOn: [`${id}-d${i}-head`],
      });
    }
  });

  steps.push({
    id: `${id}-integrate`,
    agentId: "coo",
    department: "executive",
    action: "結果を統合",
    detail: "各部署の出力を1つの報告へ統合し、推奨アクションを添える",
    etaMinutes: 4,
    dependsOn: departments.map((_, i) => `${id}-d${i}-head`),
  });

  return {
    id,
    input: trimmed,
    objective: buildObjective(trimmed),
    successCriteria: buildCriteria(departments),
    steps,
    departments,
    estimatedMinutes: Math.max(...steps.map((s) => s.etaMinutes)) + 4,
    needsApproval,
    approvalReason: needsApproval
      ? "外部への実行を伴うため、実行前にCEO承認を要求します。"
      : undefined,
  };
}

function buildObjective(input: string): string {
  const cleaned = input.replace(/[。.！!?？]+$/u, "");
  return `${cleaned} — この指示を実行可能な成果へ変換する`;
}

function buildCriteria(departments: DepartmentId[]): string[] {
  const base = ["CEOが即座に判断できる形式で報告されていること", "推奨アクションが1つに絞られていること"];
  if (departments.includes("research")) base.push("主張に一次情報の出典が添えられていること");
  if (departments.includes("finance")) base.push("金額・期間・回収見込みが明示されていること");
  if (departments.includes("engineering")) base.push("必要工数と実装順序が見積もられていること");
  return base;
}

/** Total head-count involved, used for the plan summary strip. */
export function planAgentCount(plan: CommandPlan): number {
  return new Set(plan.steps.map((s) => s.agentId)).size;
}
