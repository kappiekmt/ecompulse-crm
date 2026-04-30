import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import { useAuth } from "@/lib/auth"
import type { TeamRole } from "@/lib/database.types"

export interface SopRow {
  id: string
  slug: string | null
  category: string
  title: string
  description: string | null
  body_md: string
  visible_to: TeamRole[]
  version: number
  is_archived: boolean
  pinned_for_onboarding: boolean
  display_order: number
  read_time_minutes: number | null
  created_at: string
  updated_at: string
}

export const SOP_CATEGORIES: { key: string; label: string; emoji: string }[] = [
  { key: "onboarding", label: "Onboarding", emoji: "🚀" },
  { key: "pre_call", label: "Pre-Call", emoji: "📞" },
  { key: "on_call", label: "On-Call", emoji: "🎯" },
  { key: "post_call", label: "Post-Call", emoji: "📊" },
  { key: "coach", label: "Coach", emoji: "🎓" },
  { key: "admin", label: "Admin", emoji: "⚙️" },
]

export function useSops() {
  return useQuery<SopRow[]>({
    queryKey: ["sops-list"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      // RLS auto-filters by visible_to vs the user's role.
      const { data, error } = await supabase
        .from("sops")
        .select(
          "id, slug, category, title, description, body_md, visible_to, version, is_archived, pinned_for_onboarding, display_order, read_time_minutes, created_at, updated_at"
        )
        .eq("is_archived", false)
        .order("display_order", { ascending: true })
        .order("title", { ascending: true })
      if (error) throw error
      return (data ?? []) as SopRow[]
    },
  })
}

export function useSop(id: string | null | undefined) {
  return useQuery<SopRow | null>({
    queryKey: ["sop", id],
    enabled: Boolean(id) && isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sops")
        .select(
          "id, slug, category, title, description, body_md, visible_to, version, is_archived, pinned_for_onboarding, display_order, read_time_minutes, created_at, updated_at"
        )
        .eq("id", id!)
        .maybeSingle()
      if (error) throw error
      return data as SopRow | null
    },
  })
}

export function useSopReads() {
  const { profile } = useAuth()
  return useQuery<Set<string>>({
    queryKey: ["sop-reads", profile?.id],
    enabled: isSupabaseConfigured && Boolean(profile?.id),
    queryFn: async () => {
      const { data } = await supabase
        .from("sop_reads")
        .select("sop_id")
        .eq("team_member_id", profile!.id)
      return new Set((data ?? []).map((r) => r.sop_id))
    },
  })
}

export function useMarkSopRead() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  return useMutation({
    mutationFn: async (sopId: string) => {
      if (!profile?.id) return
      const { error } = await supabase
        .from("sop_reads")
        .insert({ sop_id: sopId, team_member_id: profile.id })
      // 23505 = unique violation (already read) — silently ignore.
      if (error && error.code !== "23505") throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sop-reads"] })
    },
  })
}

export function useUnmarkSopRead() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  return useMutation({
    mutationFn: async (sopId: string) => {
      if (!profile?.id) return
      const { error } = await supabase
        .from("sop_reads")
        .delete()
        .eq("sop_id", sopId)
        .eq("team_member_id", profile.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sop-reads"] })
    },
  })
}

export interface SopUpsertInput {
  id?: string
  slug?: string | null
  category: string
  title: string
  description?: string | null
  body_md: string
  visible_to: TeamRole[]
  pinned_for_onboarding?: boolean
  display_order?: number
  read_time_minutes?: number | null
  is_archived?: boolean
}

export function useUpsertSop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SopUpsertInput) => {
      if (input.id) {
        const { error } = await supabase
          .from("sops")
          .update({
            slug: input.slug ?? null,
            category: input.category,
            title: input.title,
            description: input.description ?? null,
            body_md: input.body_md,
            visible_to: input.visible_to,
            pinned_for_onboarding: input.pinned_for_onboarding ?? false,
            display_order: input.display_order ?? 0,
            read_time_minutes: input.read_time_minutes ?? null,
            is_archived: input.is_archived ?? false,
          })
          .eq("id", input.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from("sops").insert({
          slug: input.slug ?? null,
          category: input.category,
          title: input.title,
          description: input.description ?? null,
          body_md: input.body_md,
          visible_to: input.visible_to,
          pinned_for_onboarding: input.pinned_for_onboarding ?? false,
          display_order: input.display_order ?? 0,
          read_time_minutes: input.read_time_minutes ?? null,
        })
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sops-list"] })
      qc.invalidateQueries({ queryKey: ["sop"] })
    },
  })
}

export function useDeleteSop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sops").delete().eq("id", id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sops-list"] })
    },
  })
}
