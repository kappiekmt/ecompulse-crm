import type { TeamRole } from "@/lib/database.types"

/**
 * Role precedence — MUST match the `sync_primary_role()` trigger in
 * migration 0030. The scalar `team_members.role` (a.k.a. profile.role) is
 * always the highest-precedence role a member holds, so `profile.role ===
 * "admin"` stays correct for admins even when they also hold other roles.
 * Permission breadth comes from `profile.roles` (the full set).
 */
export const ROLE_PRECEDENCE: TeamRole[] = ["admin", "coach", "closer", "setter"]

export const ROLE_LABELS: Record<TeamRole, string> = {
  admin: "Admin",
  coach: "Coach",
  closer: "Closer",
  setter: "Setter",
}

export const ALL_ROLES: TeamRole[] = ["admin", "closer", "setter", "coach"]

/** Order a set of roles by precedence (admin first). Filters out unknowns. */
export function sortRoles(roles: TeamRole[]): TeamRole[] {
  return ROLE_PRECEDENCE.filter((r) => roles.includes(r))
}

/** Highest-precedence role in the set — the "primary". Defaults to admin. */
export function primaryRole(roles: TeamRole[] | null | undefined): TeamRole {
  if (!roles || roles.length === 0) return "admin"
  return sortRoles(roles)[0] ?? "admin"
}
