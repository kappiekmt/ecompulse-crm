import {
  LayoutDashboard,
  Users,
  PhoneCall,
  GraduationCap,
  Wallet,
  BarChart3,
  Settings,
  Workflow,
  type LucideIcon,
} from "lucide-react"
import type { TeamRole } from "@/lib/database.types"

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  roles: TeamRole[]
}

export const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    to: "/",
    icon: LayoutDashboard,
    roles: ["admin", "closer", "setter", "coach"],
  },
  {
    label: "Pipeline",
    to: "/pipeline",
    icon: PhoneCall,
    roles: ["admin", "closer", "setter"],
  },
  {
    label: "Leads",
    to: "/leads",
    icon: Users,
    roles: ["admin", "closer", "setter"],
  },
  {
    label: "Students",
    to: "/students",
    icon: GraduationCap,
    roles: ["admin", "coach"],
  },
  {
    label: "Finance",
    to: "/finance",
    icon: Wallet,
    roles: ["admin"],
  },
  {
    label: "Reports",
    to: "/reports",
    icon: BarChart3,
    roles: ["admin"],
  },
  {
    label: "Automations",
    to: "/automations",
    icon: Workflow,
    roles: ["admin"],
  },
  {
    label: "Team",
    to: "/team",
    icon: Settings,
    roles: ["admin"],
  },
]

export function navItemsForRole(role: TeamRole | null | undefined): NavItem[] {
  if (!role) return []
  return NAV_ITEMS.filter((item) => item.roles.includes(role))
}
