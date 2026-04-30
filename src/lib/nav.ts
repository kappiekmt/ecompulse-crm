import {
  LayoutDashboard,
  Users,
  GitBranch,
  BookUser,
  UsersRound,
  Upload,
  CreditCard,
  Tags,
  Plug,
  HelpCircle,
  Command,
  type LucideIcon,
} from "lucide-react"
import type { TeamRole } from "@/lib/database.types"

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  roles: TeamRole[]
}

export interface NavSection {
  label: string | null
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    items: [
      {
        label: "Dashboard",
        to: "/",
        icon: LayoutDashboard,
        roles: ["admin", "closer", "setter", "coach"],
      },
      {
        label: "Command Center",
        to: "/command-center",
        icon: Command,
        roles: ["admin", "closer", "setter"],
      },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "Leads", to: "/leads", icon: Users, roles: ["admin", "closer", "setter"] },
      { label: "Pipeline", to: "/pipeline", icon: GitBranch, roles: ["admin", "closer", "setter"] },
      { label: "Directory", to: "/directory", icon: BookUser, roles: ["admin", "closer", "setter", "coach"] },
    ],
  },
  {
    label: "Agency",
    items: [
      { label: "Team", to: "/team", icon: UsersRound, roles: ["admin"] },
      { label: "Import Leads", to: "/import-leads", icon: Upload, roles: ["admin"] },
      { label: "Import Payments", to: "/import-payments", icon: CreditCard, roles: ["admin"] },
      { label: "Lead Tags", to: "/lead-tags", icon: Tags, roles: ["admin"] },
      { label: "Integrations", to: "/integrations", icon: Plug, roles: ["admin"] },
      { label: "Help & SOPs", to: "/help", icon: HelpCircle, roles: ["admin", "closer", "setter", "coach"] },
    ],
  },
]

export function navSectionsForRole(role: TeamRole | null | undefined): NavSection[] {
  const r = role ?? "admin"
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.roles.includes(r)),
  })).filter((section) => section.items.length > 0)
}
