import type { Department, DepartmentId } from "@/lib/types";

/**
 * The eight operating departments. Each is headed by a member of the C-suite,
 * so the executive team and the org chart are the same data.
 */
export const DEPARTMENTS: Department[] = [
  {
    id: "strategy",
    name: "Strategy",
    label: "STRATEGY",
    headAgentId: "coo",
    mandate: "会社全体の方向性とリソース配分を最適化し、CEOの意思決定を支える。",
    interfaces: ["engineering", "marketing", "finance", "research"],
  },
  {
    id: "engineering",
    name: "Engineering",
    label: "ENGINEERING",
    headAgentId: "cto",
    mandate: "プロダクトと社内システムを設計・実装し、技術的な優位性を作る。",
    interfaces: ["strategy", "creative", "operations"],
  },
  {
    id: "marketing",
    name: "Marketing",
    label: "MARKETING",
    headAgentId: "cmo",
    mandate: "ブランドの認知を拡大し、需要を生み出す施策を設計・実行する。",
    interfaces: ["creative", "research", "sales"],
  },
  {
    id: "sales",
    name: "Sales",
    label: "SALES",
    headAgentId: "cso",
    mandate: "提携候補と顧客を開拓し、収益につながる関係を構築する。",
    interfaces: ["marketing", "finance", "strategy"],
  },
  {
    id: "finance",
    name: "Finance",
    label: "FINANCE",
    headAgentId: "cfo",
    mandate: "収益・コスト・投資対効果を可視化し、資金の使い道を最適化する。",
    interfaces: ["strategy", "sales", "operations"],
  },
  {
    id: "research",
    name: "Research",
    label: "RESEARCH",
    headAgentId: "research_director",
    mandate: "市場・競合・技術の動向を継続的に調査し、判断材料を供給する。",
    interfaces: ["strategy", "marketing", "engineering"],
  },
  {
    id: "creative",
    name: "Creative",
    label: "CREATIVE",
    headAgentId: "creative_director",
    mandate: "ブランド体験とビジュアルの水準を定義し、制作物の品質を担保する。",
    interfaces: ["marketing", "engineering"],
  },
  {
    id: "operations",
    name: "Operations",
    label: "OPERATIONS",
    headAgentId: "chief_of_staff",
    mandate: "社内のタスク・スケジュール・記録を整流化し、会社を止めない。",
    interfaces: ["strategy", "engineering", "finance"],
  },
];

export const DEPARTMENT_ACCENT: Record<DepartmentId, string> = {
  strategy: "#6C7CFF",
  engineering: "#4FA8FF",
  marketing: "#A78BFA",
  sales: "#31D0A0",
  finance: "#E5A84B",
  research: "#5BC8D8",
  creative: "#F0849B",
  operations: "#8E97A6",
};

export function getDepartment(id: DepartmentId): Department {
  const found = DEPARTMENTS.find((d) => d.id === id);
  if (!found) throw new Error(`Unknown department: ${id}`);
  return found;
}
