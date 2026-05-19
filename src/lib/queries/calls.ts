import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import type {
  CallAiReview,
  CallOutcome,
  CallSource,
  ObjectionCategory,
} from "@/lib/database.types"

export interface CallListRow {
  id: string
  lead_id: string | null
  closer_id: string | null
  deal_id: string | null
  source: CallSource
  fathom_share_url: string | null
  recording_url: string | null
  title: string | null
  started_at: string | null
  duration_seconds: number | null
  outcome: CallOutcome
  summary: string | null
  ai_review: CallAiReview | null
  ai_reviewed_at: string | null
  lead: { id: string; full_name: string; email: string | null } | null
  closer: { id: string; full_name: string } | null
  deal: { id: string; amount_cents: number; currency: string; status: string } | null
}

export interface CallListFilters {
  closerId?: string | null
  outcome?: CallOutcome | "all"
  search?: string
  fromDate?: string | null
  toDate?: string | null
  needsReview?: boolean
  limit?: number
}

export function useCallsList(filters: CallListFilters = {}) {
  return useQuery<CallListRow[]>({
    queryKey: ["calls-list", filters],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      let q = supabase
        .from("calls")
        .select(
          "id, lead_id, closer_id, deal_id, source, fathom_share_url, recording_url, title, started_at, duration_seconds, outcome, summary, ai_review, ai_reviewed_at, lead:leads(id, full_name, email), closer:team_members!calls_closer_id_fkey(id, full_name), deal:deals!calls_deal_id_fkey(id, amount_cents, currency, status)"
        )
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(filters.limit ?? 200)

      if (filters.closerId) q = q.eq("closer_id", filters.closerId)
      if (filters.outcome && filters.outcome !== "all") q = q.eq("outcome", filters.outcome)
      if (filters.fromDate) q = q.gte("started_at", filters.fromDate)
      if (filters.toDate) q = q.lte("started_at", filters.toDate)
      if (filters.needsReview) q = q.eq("ai_review->>needs_review", "true")
      if (filters.search) {
        const s = `%${filters.search}%`
        // Search the call title + summary. Lead-name search happens client-side
        // since PostgREST can't do `or` across joined columns cleanly.
        q = q.or(`title.ilike.${s},summary.ilike.${s}`)
      }

      const { data, error } = await q
      if (error) throw error

      let rows = (data ?? []) as unknown as CallListRow[]

      // Apply lead-name search on the client when present, so closers can find
      // calls by prospect name even if the title is generic ("Discovery call").
      if (filters.search) {
        const s = filters.search.toLowerCase()
        rows = rows.filter(
          (r) =>
            r.title?.toLowerCase().includes(s) ||
            r.summary?.toLowerCase().includes(s) ||
            r.lead?.full_name?.toLowerCase().includes(s) ||
            r.lead?.email?.toLowerCase().includes(s)
        )
      }
      return rows
    },
  })
}

export interface CallDetail extends CallListRow {
  transcript: string | null
  transcript_url: string | null
  outcome_notes: string | null
  outcome_tagged_at: string | null
  outcome_tagged_by: string | null
  ended_at: string | null
  attendee_emails: string[] | null
  host_email: string | null
  action_items: {
    id: string
    description: string
    assignee: string | null
    due_date: string | null
    completed: boolean
    source: CallSource
  }[]
  objections: {
    id: string
    quote: string | null
    source: CallSource
    objection: { id: string; label: string; category: ObjectionCategory } | null
  }[]
}

export function useCall(callId: string | null) {
  return useQuery<CallDetail | null>({
    queryKey: ["call", callId],
    enabled: isSupabaseConfigured && Boolean(callId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("calls")
        .select(
          "id, lead_id, closer_id, deal_id, source, fathom_share_url, recording_url, transcript_url, title, started_at, ended_at, duration_seconds, host_email, attendee_emails, summary, transcript, outcome, outcome_notes, outcome_tagged_by, outcome_tagged_at, ai_review, ai_reviewed_at, lead:leads(id, full_name, email), closer:team_members!calls_closer_id_fkey(id, full_name), deal:deals!calls_deal_id_fkey(id, amount_cents, currency, status), action_items:call_action_items(id, description, assignee, due_date, completed, source), objections:call_objections(id, quote, source, objection:objections(id, label, category))"
        )
        .eq("id", callId!)
        .maybeSingle()
      if (error) throw error
      return (data as unknown as CallDetail) ?? null
    },
  })
}

export function useUpdateCallOutcome() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      callId: string
      outcome: CallOutcome
      notes?: string | null
      taggedBy: string
    }) => {
      const { error } = await supabase
        .from("calls")
        .update({
          outcome: args.outcome,
          outcome_notes: args.notes ?? null,
          outcome_tagged_by: args.taggedBy,
          outcome_tagged_at: new Date().toISOString(),
        })
        .eq("id", args.callId)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["call", vars.callId] })
      qc.invalidateQueries({ queryKey: ["calls-list"] })
      qc.invalidateQueries({ queryKey: ["leads-list"] })
      qc.invalidateQueries({ queryKey: ["lead"] })
    },
  })
}

export function useToggleActionItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { itemId: string; callId: string; completed: boolean }) => {
      const { error } = await supabase
        .from("call_action_items")
        .update({
          completed: args.completed,
          completed_at: args.completed ? new Date().toISOString() : null,
        })
        .eq("id", args.itemId)
      if (error) throw error
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["call", vars.callId] }),
  })
}

export function useObjections() {
  return useQuery({
    queryKey: ["objections"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("objections")
        .select("id, label, description, category")
        .order("category")
        .order("label")
      if (error) throw error
      return data ?? []
    },
  })
}

export function useToggleCallObjection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      callId: string
      objectionId: string
      attach: boolean
      quote?: string | null
    }) => {
      if (args.attach) {
        const { error } = await supabase.from("call_objections").insert({
          call_id: args.callId,
          objection_id: args.objectionId,
          quote: args.quote ?? null,
          source: "manual",
        })
        if (error && error.code !== "23505") throw error // ignore unique violations
      } else {
        const { error } = await supabase
          .from("call_objections")
          .delete()
          .eq("call_id", args.callId)
          .eq("objection_id", args.objectionId)
        if (error) throw error
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["call", vars.callId] })
      qc.invalidateQueries({ queryKey: ["objection-rollup"] })
    },
  })
}

export interface CallSummary {
  total: number
  pending_outcome: number
  closed_won: number
  needs_review: number
}

export function useCallsSummary(closerId?: string | null) {
  return useQuery<CallSummary>({
    queryKey: ["calls-summary", closerId ?? null],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      let base = supabase.from("calls").select("id, outcome, ai_review", { count: "exact" })
      if (closerId) base = base.eq("closer_id", closerId)
      const { data, count, error } = await base
      if (error) throw error
      const rows = (data ?? []) as { outcome: CallOutcome; ai_review: CallAiReview | null }[]
      return {
        total: count ?? rows.length,
        pending_outcome: rows.filter((r) => r.outcome === "pending").length,
        closed_won: rows.filter((r) => r.outcome === "closed_won").length,
        needs_review: rows.filter((r) => r.ai_review?.needs_review === true).length,
      }
    },
  })
}

export interface CloserCallStatsRow {
  closer_id: string
  full_name: string
  calls_total: number
  calls_30d: number
  calls_7d: number
  closes: number
  untagged_outcomes: number
  tagged_outcomes: number
  needs_review: number
  avg_duration_seconds: number
  close_rate_pct: number
  avg_framework_score: number
}

export function useCloserCallStats(closerId?: string | null) {
  return useQuery<CloserCallStatsRow[]>({
    queryKey: ["closer-call-stats", closerId ?? null],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      let q = supabase
        .from("closer_call_stats_v")
        .select(
          "closer_id, full_name, calls_total, calls_30d, calls_7d, closes, untagged_outcomes, tagged_outcomes, needs_review, avg_duration_seconds, close_rate_pct, avg_framework_score"
        )
        .order("close_rate_pct", { ascending: false })
      if (closerId) q = q.eq("closer_id", closerId)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as CloserCallStatsRow[]
    },
  })
}

export interface ObjectionRollupRow {
  closer_id: string | null
  objection_id: string
  label: string
  category: ObjectionCategory
  week_start: string
  occurrences: number
  example_call_ids: string[]
}

export function useObjectionRollup(filters: {
  closerId?: string | null
  weeksBack?: number
} = {}) {
  return useQuery<ObjectionRollupRow[]>({
    queryKey: ["objection-rollup", filters],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      let q = supabase
        .from("objection_rollup")
        .select("closer_id, objection_id, label, category, week_start, occurrences, example_call_ids")
        .order("occurrences", { ascending: false })
      if (filters.closerId) q = q.eq("closer_id", filters.closerId)
      if (filters.weeksBack) {
        const since = new Date()
        since.setDate(since.getDate() - filters.weeksBack * 7)
        q = q.gte("week_start", since.toISOString().slice(0, 10))
      }
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as ObjectionRollupRow[]
    },
  })
}
