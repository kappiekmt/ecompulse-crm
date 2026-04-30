// Pick the active coach (or admin acting as coach) with the fewest
// pending/in-progress students. Used by stripe-webhook + manual-payment
// flows to load-balance new enrollments.
//
// Returns null only if no active coach/admin exists at all.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

export async function pickLeastLoadedCoach(
  client: SupabaseClient
): Promise<string | null> {
  const { data: candidates } = await client
    .from("team_members")
    .select("id, full_name")
    .in("role", ["coach", "admin"])
    .eq("is_active", true)
  if (!candidates || candidates.length === 0) return null

  const { data: students } = await client
    .from("students")
    .select("coach_id")
    .in("onboarding_status", ["pending", "in_progress"])
    .not("coach_id", "is", null)

  const counts = new Map<string, number>()
  for (const s of students ?? []) {
    if (s.coach_id) counts.set(s.coach_id, (counts.get(s.coach_id) ?? 0) + 1)
  }

  return [...candidates]
    .sort((a, b) => {
      const ca = counts.get(a.id) ?? 0
      const cb = counts.get(b.id) ?? 0
      if (ca !== cb) return ca - cb
      return a.full_name.localeCompare(b.full_name)
    })[0].id
}
