import { useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"

export interface DeleteResult {
  ok?: boolean
  warning?: string
  deleted?: { full_name: string; email: string }
  error?: string
}

async function callDeleteUser(team_member_id: string): Promise<DeleteResult> {
  const { data: sess } = await supabase.auth.getSession()
  const jwt = sess.session?.access_token
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-delete-user`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ team_member_id }),
  })
  return (await res.json()) as DeleteResult
}

export function useDeleteTeamMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: callDeleteUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-list"] })
      qc.invalidateQueries({ queryKey: ["team-members"] })
    },
  })
}
