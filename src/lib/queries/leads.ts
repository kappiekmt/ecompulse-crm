import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import type { LeadStage } from "@/lib/database.types"

export interface LeadListRow {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  instagram: string | null
  stage: LeadStage
  closer_id: string | null
  setter_id: string | null
  utm_source: string | null
  utm_campaign: string | null
  notes: string | null
  created_at: string
  updated_at: string
  closer?: { id: string; full_name: string } | null
  setter?: { id: string; full_name: string } | null
  tags: { tag_id: string; tag: { name: string; color: string } | null }[]
}

export interface LeadListFilters {
  stages?: LeadStage[]
  closerId?: string | null
  setterId?: string | null
  search?: string
  tagId?: string | null
  sortField?: "created_at" | "updated_at" | "full_name" | "stage"
  sortAsc?: boolean
  limit?: number
}

export function useLeadsList(filters: LeadListFilters = {}) {
  return useQuery<LeadListRow[]>({
    queryKey: ["leads-list", filters],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      let q = supabase
        .from("leads")
        .select(
          "id, full_name, email, phone, instagram, stage, closer_id, setter_id, utm_source, utm_campaign, notes, created_at, updated_at, closer:team_members!leads_closer_id_fkey(id, full_name), setter:team_members!leads_setter_id_fkey(id, full_name), tags:lead_tag_assignments(tag_id, tag:lead_tags(name, color))"
        )

      if (filters.stages?.length) {
        q = q.in("stage", filters.stages)
      }
      if (filters.closerId) q = q.eq("closer_id", filters.closerId)
      if (filters.setterId) q = q.eq("setter_id", filters.setterId)
      if (filters.search?.trim()) {
        const s = `%${filters.search.trim()}%`
        q = q.or(`full_name.ilike.${s},email.ilike.${s},phone.ilike.${s},instagram.ilike.${s}`)
      }

      const sortField = filters.sortField ?? "created_at"
      q = q.order(sortField, { ascending: filters.sortAsc ?? false })
      q = q.limit(filters.limit ?? 100)

      const { data, error } = await q
      if (error) throw error

      let rows = (data ?? []) as unknown as LeadListRow[]

      // Tag filter is applied post-fetch since PostgREST can't filter on joined arrays in a simple way.
      if (filters.tagId) {
        rows = rows.filter((l) => l.tags?.some((t) => t.tag_id === filters.tagId))
      }
      return rows
    },
  })
}

export function useLead(id: string | null | undefined) {
  return useQuery<LeadListRow | null>({
    queryKey: ["lead", id],
    enabled: Boolean(id) && isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select(
          "id, full_name, email, phone, instagram, stage, closer_id, setter_id, utm_source, utm_campaign, notes, created_at, updated_at, closer:team_members!leads_closer_id_fkey(id, full_name), setter:team_members!leads_setter_id_fkey(id, full_name), tags:lead_tag_assignments(tag_id, tag:lead_tags(name, color))"
        )
        .eq("id", id!)
        .maybeSingle()
      if (error) throw error
      return data as unknown as LeadListRow | null
    },
  })
}

export interface LeadUpdateInput {
  full_name?: string
  email?: string | null
  phone?: string | null
  instagram?: string | null
  timezone?: string | null
  stage?: LeadStage
  closer_id?: string | null
  setter_id?: string | null
  notes?: string | null
}

export function useUpdateLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: LeadUpdateInput }) => {
      const { error } = await supabase.from("leads").update(patch).eq("id", id)
      if (error) throw error
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["leads-list"] })
      qc.invalidateQueries({ queryKey: ["lead", vars.id] })
      qc.invalidateQueries({ queryKey: ["kpi-snapshot"] })
      qc.invalidateQueries({ queryKey: ["closer-performance"] })
      qc.invalidateQueries({ queryKey: ["setter-performance"] })
    },
  })
}

export function useDeleteLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("leads").delete().eq("id", id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads-list"] })
    },
  })
}

export interface CreateLeadInput {
  full_name: string
  email?: string | null
  phone?: string | null
  instagram?: string | null
  stage?: LeadStage
  closer_id?: string | null
  setter_id?: string | null
  notes?: string | null
}

export function useCreateLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateLeadInput) => {
      const { data, error } = await supabase
        .from("leads")
        .insert({
          ...input,
          stage: input.stage ?? "new",
        })
        .select("id")
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads-list"] })
    },
  })
}

// Tags — lead-scoped
export function useLeadTagsAll() {
  return useQuery({
    queryKey: ["lead-tags-all"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_tags")
        .select("id, name, description, color")
        .order("name")
      if (error) throw error
      return data ?? []
    },
  })
}

export function useToggleLeadTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      leadId,
      tagId,
      assign,
    }: {
      leadId: string
      tagId: string
      assign: boolean
    }) => {
      if (assign) {
        const { error } = await supabase
          .from("lead_tag_assignments")
          .insert({ lead_id: leadId, tag_id: tagId })
        if (error && error.code !== "23505") throw error
      } else {
        const { error } = await supabase
          .from("lead_tag_assignments")
          .delete()
          .eq("lead_id", leadId)
          .eq("tag_id", tagId)
        if (error) throw error
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["leads-list"] })
      qc.invalidateQueries({ queryKey: ["lead", vars.leadId] })
    },
  })
}

// Activities — for the lead timeline
export function useLeadActivities(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ["lead-activities", leadId],
    enabled: Boolean(leadId) && isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activities")
        .select("id, type, payload, created_at")
        .eq("lead_id", leadId!)
        .order("created_at", { ascending: false })
        .limit(50)
      if (error) throw error
      return data ?? []
    },
  })
}

// Call outcomes
export function useLeadCallOutcomes(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ["lead-call-outcomes", leadId],
    enabled: Boolean(leadId) && isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_outcomes")
        .select("id, result, reason, notes, scheduled_for, occurred_at, closer_id, created_at")
        .eq("lead_id", leadId!)
        .order("created_at", { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

export type CallResult =
  | "showed"
  | "no_show"
  | "pitched"
  | "closed"
  | "lost"
  | "rescheduled"

const RESULT_TO_STAGE: Record<CallResult, LeadStage | null> = {
  showed: "showed",
  no_show: "no_show",
  pitched: "pitched",
  closed: "won",
  lost: "lost",
  rescheduled: null,
}

export function useLogCallOutcome() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      leadId: string
      closerId: string | null
      result: CallResult
      occurredAt?: string | null
      reason?: string | null
      notes?: string | null
    }) => {
      const { error } = await supabase.from("call_outcomes").insert({
        lead_id: input.leadId,
        closer_id: input.closerId,
        result: input.result,
        occurred_at: input.occurredAt ?? new Date().toISOString(),
        reason: input.reason ?? null,
        notes: input.notes ?? null,
      })
      if (error) throw error

      const newStage = RESULT_TO_STAGE[input.result]
      if (newStage) {
        const { error: stageErr } = await supabase
          .from("leads")
          .update({ stage: newStage })
          .eq("id", input.leadId)
        if (stageErr) throw stageErr
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["leads-list"] })
      qc.invalidateQueries({ queryKey: ["lead", vars.leadId] })
      qc.invalidateQueries({ queryKey: ["lead-call-outcomes", vars.leadId] })
      qc.invalidateQueries({ queryKey: ["kpi-snapshot"] })
      qc.invalidateQueries({ queryKey: ["closer-performance"] })
    },
  })
}
