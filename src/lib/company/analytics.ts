import type { DepartmentId } from "@/lib/types";

/** Mock series. Replaced by real aggregates once the database layer lands. */

export const THROUGHPUT_14D = [
  { day: "09/08", completed: 38, created: 44 },
  { day: "09/09", completed: 41, created: 39 },
  { day: "09/10", completed: 36, created: 47 },
  { day: "09/11", completed: 44, created: 42 },
  { day: "09/12", completed: 49, created: 45 },
  { day: "09/13", completed: 31, created: 28 },
  { day: "09/14", completed: 27, created: 24 },
  { day: "09/15", completed: 46, created: 51 },
  { day: "09/16", completed: 52, created: 48 },
  { day: "09/17", completed: 47, created: 53 },
  { day: "09/18", completed: 55, created: 50 },
  { day: "09/19", completed: 48, created: 56 },
  { day: "09/20", completed: 48, created: 46 },
  { day: "09/21", completed: 51, created: 64 },
];

export const REVENUE_6M = [
  { month: "Apr", revenue: 1840000, cost: 980000 },
  { month: "May", revenue: 2120000, cost: 1040000 },
  { month: "Jun", revenue: 2460000, cost: 1180000 },
  { month: "Jul", revenue: 2780000, cost: 1240000 },
  { month: "Aug", revenue: 3096000, cost: 1310000 },
  { month: "Sep", revenue: 3482000, cost: 1362000 },
];

export const DEPARTMENT_LOAD: { department: DepartmentId; active: number; completed: number; utilization: number }[] = [
  { department: "engineering", active: 6, completed: 18, utilization: 92 },
  { department: "marketing", active: 5, completed: 12, utilization: 74 },
  { department: "research", active: 5, completed: 14, utilization: 88 },
  { department: "sales", active: 5, completed: 9, utilization: 81 },
  { department: "creative", active: 5, completed: 7, utilization: 69 },
  { department: "finance", active: 5, completed: 6, utilization: 58 },
  { department: "strategy", active: 5, completed: 5, utilization: 63 },
  { department: "operations", active: 5, completed: 11, utilization: 77 },
];

export const AI_USAGE_7D = [
  { day: "Mon", tokens: 1_840_000, calls: 1240 },
  { day: "Tue", tokens: 2_120_000, calls: 1388 },
  { day: "Wed", tokens: 1_960_000, calls: 1301 },
  { day: "Thu", tokens: 2_480_000, calls: 1572 },
  { day: "Fri", tokens: 2_740_000, calls: 1694 },
  { day: "Sat", tokens: 980_000, calls: 612 },
  { day: "Sun", tokens: 1_120_000, calls: 703 },
];

export const FUNNEL = [
  { stage: "Identified", value: 186 },
  { stage: "Qualified", value: 94 },
  { stage: "Contacted", value: 41 },
  { stage: "In talks", value: 18 },
  { stage: "Agreed", value: 6 },
];

export const COMPANY_KPIS = [
  { label: "Revenue (MTD)", value: "¥3,482,000", delta: "+12.4%", positive: true },
  { label: "Followers", value: "248,532", delta: "+18.7%", positive: true },
  { label: "New leads", value: "186", delta: "+32.1%", positive: true },
  { label: "Task completion (30d)", value: "87%", delta: "+6.3%", positive: true },
  { label: "Avg. task latency", value: "18m", delta: "-14%", positive: true },
  { label: "Cost / task", value: "¥62", delta: "-8%", positive: true },
];
