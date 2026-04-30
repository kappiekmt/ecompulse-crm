import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import type { LeadStage } from "@/lib/database.types"
import { tierByAmountCents, tierByKey } from "@/lib/tiers"

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
  source: string | null
  intended_tier: string | null
  booked_at: string | null
  scheduled_at: string | null
  cancelled_at: string | null
  closed_at: string | null
  budget_cents: number | null
  calendly_cancel_url: string | null
  calendly_reschedule_url: string | null
  pre_call_started: boolean
  pre_call_started_at: string | null
  pre_call_completed_at: string | null
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
          "id, full_name, email, phone, instagram, stage, closer_id, setter_id, utm_source, utm_campaign, notes, source, intended_tier, booked_at, scheduled_at, cancelled_at, closed_at, budget_cents, calendly_cancel_url, calendly_reschedule_url, pre_call_started, pre_call_started_at, pre_call_completed_at, created_at, updated_at, closer:team_members!leads_closer_id_fkey(id, full_name), setter:team_members!leads_setter_id_fkey(id, full_name), tags:lead_tag_assignments(tag_id, tag:lead_tags(name, color))"
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
          "id, full_name, email, phone, instagram, stage, closer_id, setter_id, utm_source, utm_campaign, notes, source, intended_tier, booked_at, scheduled_at, cancelled_at, closed_at, budget_cents, calendly_cancel_url, calendly_reschedule_url, pre_call_started, pre_call_started_at, pre_call_completed_at, created_at, updated_at, closer:team_members!leads_closer_id_fkey(id, full_name), setter:team_members!leads_setter_id_fkey(id, full_name), tags:lead_tag_assignments(tag_id, tag:lead_tags(name, color))"
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
  intended_tier?: string | null
  budget_cents?: number | null
  scheduled_at?: string | null
  closed_at?: string | null
  cancelled_at?: string | null
  pre_call_started?: boolean
  pre_call_started_at?: string | null
  pre_call_completed_at?: string | null
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

// Payments — for the drawer's payments section
export function useLeadPayments(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ["lead-payments", leadId],
    enabled: Boolean(leadId) && isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id, amount_cents, currency, paid_at, source, is_refund, notes, stripe_charge_id")
        .eq("lead_id", leadId!)
        .order("paid_at", { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

/**
 * Manual "Add payment" on a lead. Mirrors the stripe-webhook end-to-end
 * enrollment flow:
 *   1. Resolve tier — lead.intended_tier wins, else amount-based match.
 *   2. Find or create the deal (won, status=won).
 *   3. Insert the payment row (source='manual').
 *   4. Move the lead to stage='won'.
 *   5. Find or create the student row, auto-assigning the least-loaded
 *      active coach/admin.
 * Idempotent — re-running on the same lead+amount won't duplicate rows.
 */
export function useAddPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      leadId: string
      amount_cents: number
      currency?: string
      paid_at?: string
      notes?: string | null
    }) => {
      const paidAt = input.paid_at ?? new Date().toISOString()
      const currency = input.currency ?? "EUR"

      // 1. Lead context (intended tier).
      const { data: lead } = await supabase
        .from("leads")
        .select("intended_tier")
        .eq("id", input.leadId)
        .single()
      const tier =
        tierByKey(lead?.intended_tier ?? null) ??
        tierByAmountCents(input.amount_cents)
      const programName = tier?.program ?? "default"

      // 2. Find or create the deal. Match by lead+amount so a duplicate
      //    "Add payment" of the same value doesn't create a second deal.
      let dealId: string | null = null
      const { data: existingDeal } = await supabase
        .from("deals")
        .select("id")
        .eq("lead_id", input.leadId)
        .eq("amount_cents", input.amount_cents)
        .eq("status", "won")
        .maybeSingle()
      if (existingDeal) {
        dealId = existingDeal.id
      } else {
        const { data: newDeal, error: dealErr } = await supabase
          .from("deals")
          .insert({
            lead_id: input.leadId,
            program: programName,
            amount_cents: input.amount_cents,
            currency,
            status: "won",
            closed_at: paidAt,
          })
          .select("id")
          .single()
        if (dealErr) throw dealErr
        dealId = newDeal?.id ?? null
      }

      // 3. Payment row.
      const { error: payErr } = await supabase.from("payments").insert({
        lead_id: input.leadId,
        deal_id: dealId,
        amount_cents: input.amount_cents,
        currency,
        paid_at: paidAt,
        source: "manual",
        notes: input.notes ?? null,
      })
      if (payErr) throw payErr

      // 4. Lead → won.
      await supabase.from("leads").update({ stage: "won" }).eq("id", input.leadId)

      // 5. Student row — find or create, auto-assign coach.
      if (dealId) {
        const { data: existingStudent } = await supabase
          .from("students")
          .select("id, coach_id")
          .eq("deal_id", dealId)
          .maybeSingle()

        if (!existingStudent) {
          const coachId = await pickLeastLoadedCoach()
          await supabase.from("students").insert({
            lead_id: input.leadId,
            deal_id: dealId,
            coach_id: coachId,
            program: programName,
            onboarding_status: "pending",
            enrolled_at: paidAt,
          })
        } else if (!existingStudent.coach_id) {
          const coachId = await pickLeastLoadedCoach()
          if (coachId) {
            await supabase
              .from("students")
              .update({ coach_id: coachId })
              .eq("id", existingStudent.id)
          }
        }
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["lead-payments", vars.leadId] })
      qc.invalidateQueries({ queryKey: ["lead", vars.leadId] })
      qc.invalidateQueries({ queryKey: ["leads-list"] })
      qc.invalidateQueries({ queryKey: ["students-list"] })
      qc.invalidateQueries({ queryKey: ["student-counts"] })
      qc.invalidateQueries({ queryKey: ["my-students"] })
      qc.invalidateQueries({ queryKey: ["my-student-counts"] })
      qc.invalidateQueries({ queryKey: ["kpi-snapshot"] })
      qc.invalidateQueries({ queryKey: ["closer-performance"] })
    },
  })
}

/**
 * Pick the active coach (or admin acting as coach) with the fewest
 * pending/in-progress students. Tie-break alphabetically for deterministic
 * test behaviour.
 */
async function pickLeastLoadedCoach(): Promise<string | null> {
  const { data: candidates } = await supabase
    .from("team_members")
    .select("id, full_name")
    .in("role", ["coach", "admin"])
    .eq("is_active", true)
  if (!candidates?.length) return null

  const { data: students } = await supabase
    .from("students")
    .select("coach_id")
    .in("onboarding_status", ["pending", "in_progress"])
    .not("coach_id", "is", null)

  const counts = new Map<string, number>()
  for (const s of students ?? []) {
    if (s.coach_id) counts.set(s.coach_id, (counts.get(s.coach_id) ?? 0) + 1)
  }

  return [...candidates].sort((a, b) => {
    const ca = counts.get(a.id) ?? 0
    const cb = counts.get(b.id) ?? 0
    if (ca !== cb) return ca - cb
    return a.full_name.localeCompare(b.full_name)
  })[0].id
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
