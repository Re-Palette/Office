import {
  Activity,
  BarChart3,
  Building2,
  CalendarClock,
  FileText,
  FolderKanban,
  Home,
  Library,
  ListChecks,
  Settings,
  Terminal,
  Users,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  /** Key used to pull a live badge count out of the store. */
  badge?: "approvals" | "tasks" | "agents";
}

export const NAV_PRIMARY: NavItem[] = [
  { href: "/", label: "HOME", icon: Home },
  { href: "/command", label: "COMMAND", icon: Terminal },
];

export const NAV_COMPANY: NavItem[] = [
  { href: "/employees", label: "AI EMPLOYEES", icon: Users, badge: "agents" },
  { href: "/departments", label: "DEPARTMENTS", icon: Building2 },
  { href: "/projects", label: "PROJECTS", icon: FolderKanban },
  { href: "/tasks", label: "TASKS", icon: ListChecks, badge: "tasks" },
];

export const NAV_INTEL: NavItem[] = [
  { href: "/activity", label: "ACTIVITY", icon: Activity },
  { href: "/reports", label: "REPORTS", icon: FileText },
  { href: "/meetings", label: "MEETINGS", icon: CalendarClock },
  { href: "/knowledge", label: "KNOWLEDGE", icon: Library },
  { href: "/analytics", label: "ANALYTICS", icon: BarChart3 },
];

export const NAV_SYSTEM: NavItem[] = [
  { href: "/settings", label: "SETTINGS", icon: Settings },
];

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "", items: NAV_PRIMARY },
  { label: "COMPANY", items: NAV_COMPANY },
  { label: "INTELLIGENCE", items: NAV_INTEL },
  { label: "SYSTEM", items: NAV_SYSTEM },
];
