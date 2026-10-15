import {
  Activity,
  ClipboardList,
  FileText,
  Gauge,
  History,
  LayoutDashboard,
  ListChecks,
  MapPin,
  PlusCircle,
  Search,
  TrendingUp,
  Settings,
  Globe,
  MailPlus,
  UserCog,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Pages that show one audit keep the ?audit= query when navigating between them. */
  auditScoped?: boolean;
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Audits",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, auditScoped: true },
      { href: "/audits/new", label: "New Audit", icon: PlusCircle },
      { href: "/audits", label: "Audit History", icon: History },
      { href: "/progress", label: "SEO Progress", icon: TrendingUp },
    ],
  },
  {
    label: "Google",
    items: [{ href: "/search-console", label: "Search Performance", icon: Search }],
  },
  {
    label: "Findings",
    items: [
      { href: "/technical", label: "Technical SEO", icon: Wrench, auditScoped: true },
      { href: "/on-page", label: "On-Page SEO", icon: ListChecks, auditScoped: true },
      { href: "/performance", label: "Performance", icon: Gauge, auditScoped: true },
      { href: "/local", label: "Local SEO", icon: MapPin, auditScoped: true },
      { href: "/recommendations", label: "Recommendations", icon: ClipboardList, auditScoped: true },
    ],
  },
  {
    label: "Output",
    items: [
      { href: "/fix", label: "Fix with AI", icon: Sparkles, auditScoped: true },
      { href: "/reports", label: "Reports", icon: FileText, auditScoped: true },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

/** Customer beta: only features migrated to tenant-scoped PostgreSQL appear here. */
const BETA_NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { href: "/beta", label: "Dashboard", icon: LayoutDashboard },
      { href: "/beta/websites", label: "Websites", icon: Globe },
      { href: "/beta/audits", label: "Audit history", icon: History },
      { href: "/beta/progress", label: "SEO progress", icon: TrendingUp },
      { href: "/beta/search-console", label: "Search performance", icon: TrendingUp },
    ],
  },
  { label: "Account", items: [{ href: "/beta/account", label: "Account settings", icon: UserCog }] },
];

const BETA_ADMIN_NAV = [...BETA_NAV, { label: "Administration", items: [{ href: "/beta/admin", label: "Accounts and invitations", icon: MailPlus }, { href: "/beta/admin/operations", label: "Operations", icon: Activity }] }];

export type NavVariant = "legacy" | "beta" | "beta-admin";
export const NAV_VARIANTS: Record<NavVariant, { home: string; groups: { label: string; items: NavItem[] }[] }> = {
  legacy: { home: "/", groups: NAV_GROUPS },
  beta: { home: "/beta", groups: BETA_NAV },
  "beta-admin": { home: "/beta", groups: BETA_ADMIN_NAV },
};

export const BRAND_ICON = Activity;
