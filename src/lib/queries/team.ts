import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import type { TeamRole } from "@/lib/database.types"

export interface TeamMemberRow {
  id: string
  user_id: string | null
  full_name: string
  email: string
  role: TeamRole
  timezone: string | null
  commission_pct: number | null
  capacity: number | null
  is_active: boolean
  slack_user_id: string | null
  created_at: string
}

export function useTeamList() {
  return useQuery<TeamMemberRow[]>({
    queryKey: ["team-list"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_members")
        .select(
          "id, user_id, full_name, email, role, timezone, commission_pct, capacity, is_active, slack_user_id, created_at"
        )
        .order("created_at", { ascending: true })
      if (error) throw error
      return (data ?? []) as TeamMemberRow[]
    },
  })
}

export function useUpdateTeamMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<Omit<TeamMemberRow, "id" | "created_at" | "user_id">>
    }) => {
      const { error } = await supabase.from("team_members").update(patch).eq("id", id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-list"] })
      qc.invalidateQueries({ queryKey: ["team-members"] })
    },
  })
}

export interface InviteResult {
  ok: boolean
  team_member_id?: string
  user_id?: string
  email?: string
  temp_password?: string
  error?: string
}

export async function inviteTeamMember(input: {
  email: string
  full_name: string
  role: TeamRole
  timezone?: string
  commission_pct?: number | null
  capacity?: number | null
  slack_user_id?: string | null
}): Promise<InviteResult> {
  const { data: sess } = await supabase.auth.getSession()
  const jwt = sess.session?.access_token
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-invite`

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(input),
  })
  return (await res.json()) as InviteResult
}
