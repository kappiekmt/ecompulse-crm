import * as React from "react"
import type { TeamRole } from "@/lib/database.types"
import { useAuth } from "@/lib/auth"
import { primaryRole } from "@/lib/roles"
import { RoleTabs } from "@/components/RoleTabs"
import { AdminDashboard } from "@/pages/dashboards/AdminDashboard"
import { CloserDashboard } from "@/pages/dashboards/CloserDashboard"
import { SetterDashboard } from "@/pages/dashboards/SetterDashboard"
import { CoachDashboard } from "@/pages/dashboards/CoachDashboard"

const DASHBOARD_BY_ROLE: Record<TeamRole, React.ComponentType> = {
  admin: AdminDashboard,
  closer: CloserDashboard,
  setter: SetterDashboard,
  coach: CoachDashboard,
}

/**
 * Renders the dashboard for the signed-in user's role. Members with more than
 * one role get a tab strip to switch between their role views; single-role
 * members (and the preview/unloaded state) just see one dashboard.
 */
export function Dashboard() {
  const { profile } = useAuth()
  const roles = profile?.roles?.length ? profile.roles : (["admin"] as TeamRole[])
  const [active, setActive] = React.useState<TeamRole>(() => primaryRole(roles))

  // Keep the active tab valid if the user's roles change (e.g. on re-fetch).
  const current = roles.includes(active) ? active : primaryRole(roles)
  const View = DASHBOARD_BY_ROLE[current]

  return (
    <div className="flex flex-col">
      <RoleTabs roles={roles} value={current} onChange={setActive} />
      <View />
    </div>
  )
}
