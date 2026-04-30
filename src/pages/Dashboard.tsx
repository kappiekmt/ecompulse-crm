import { useAuth } from "@/lib/auth"
import { AdminDashboard } from "@/pages/dashboards/AdminDashboard"
import { CloserDashboard } from "@/pages/dashboards/CloserDashboard"
import { SetterDashboard } from "@/pages/dashboards/SetterDashboard"
import { CoachDashboard } from "@/pages/dashboards/CoachDashboard"

/**
 * Renders a different dashboard depending on the signed-in user's role.
 *  - Admin: full team-wide manager view (KPIs, leaderboards, EOD)
 *  - Closer: today's calls + my pipeline + my stats
 *  - Setter: my bookings + booking quality stats
 *  - Coach: my students + onboarding queue
 *  - No profile yet (preview / unloaded): falls back to admin view
 */
export function Dashboard() {
  const { profile } = useAuth()
  const role = profile?.role
  if (role === "closer") return <CloserDashboard />
  if (role === "setter") return <SetterDashboard />
  if (role === "coach") return <CoachDashboard />
  return <AdminDashboard />
}
