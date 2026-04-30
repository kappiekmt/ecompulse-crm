import { useQuery } from "@tanstack/react-query"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import { useAuth } from "@/lib/auth"
import type { LeadStage } from "@/lib/database.types"

/**
 * "Today" boundaries in the user's timezone (or UTC if not set).
 * Returns ISO UTC strings for use in `gte` / `lt` filters.
 */
function todayBoundsForTimezone(timezone?: string | null): {
  startUtc: string
  endUtc: string
} {
  const tz = timezone ?? "UTC"
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value])
  ) as Record<string, string>
  // Find the UTC instant that is 00:00 in the target tz on the given date.
  // Try a window of hour offsets and pick the candidate whose Intl-formatted
  // date matches at hour=00.
  const yearN = parseInt(parts.year)
  const monthN = parseInt(parts.month) - 1
  const dayN = parseInt(parts.day)
  let startUtc = new Date(Date.UTC(yearN, monthN, dayN))
  for (let offsetH = -12; offsetH <= 14; offsetH++) {
    const candidate = new Date(Date.UTC(yearN, monthN, dayN, offsetH))
    const f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    const cp = Object.fromEntries(
      f.formatToParts(candidate).map((p) => [p.type, p.value])
    ) as Record<string, string>
    if (
      cp.year === parts.year &&
      cp.month === parts.month &&
      cp.day === parts.day &&
      cp.hour === "00" &&
      cp.minute === "00"
    ) {
      startUtc = candidate
      break
    }
  }
  const endUtc = new Date(startUtc.getTime() + 24 * 3600 * 1000)
  return {
    startUtc: startUtc.toISOString(),
    endUtc: endUtc.toISOString(),
  }
}

function periodStart(period: "today" | "week" | "month", timezone?: string | null) {
  const { startUtc } = todayBoundsForTimezone(timezone)
  if (period === "today") return startUtc
  const today = new Date(startUtc)
  if (period === "week") {
    // Start of ISO week (Monday)
    const day = today.getUTCDay()
    const diff = day === 0 ? -6 : 1 - day
    today.setUTCDate(today.getUTCDate() + diff)
  } else {
    today.setUTCDate(1)
  }
  return today.toISOString()
}

// ─── CLOSER ──────────────────────────────────────────────────────────────────

export interface TodayCallRow {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  instagram: string | null
  scheduled_at: string | null
  pre_call_started: boolean
  stage: LeadStage
}

export function useMyTodayCalls() {
  const { profile } = useAuth()
  return useQuery<TodayCallRow[]>({
    queryKey: ["my-today-calls", profile?.id],
    enabled: isSupabaseConfigured && Boolean(profile?.id),
    queryFn: async () => {
      const { startUtc, endUtc } = todayBoundsForTimezone(null) // RLS already scopes to me
      const { data, error } = await supabase
        .from("leads")
        .select(
          "id, full_name, email, phone, instagram, scheduled_at, pre_call_started, stage"
        )
        .gte("scheduled_at", startUtc)
        .lt("scheduled_at", endUtc)
        .order("scheduled_at", { ascending: true })
      if (error) throw error
      return (data ?? []) as TodayCallRow[]
    },
  })
}

export interface PipelineCounts {
  booked: number
  confirmed: number
  showed: number
  pitched: number
  won: number
  lost: number
  cancelled: number
  no_show: number
  follow_up_short: number
  follow_up_long: number
}

export function useMyPipelineCounts() {
  return useQuery<PipelineCounts>({
    queryKey: ["my-pipeline-counts"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      // RLS auto-filters to leads I'm closer/setter on (or all for admin).
      const { data, error } = await supabase.from("leads").select("stage")
      if (error) throw error
      const counts: PipelineCounts = {
        booked: 0,
        confirmed: 0,
        showed: 0,
        pitched: 0,
        won: 0,
        lost: 0,
        cancelled: 0,
        no_show: 0,
        follow_up_short: 0,
        follow_up_long: 0,
      }
      for (const r of (data ?? []) as { stage: LeadStage }[]) {
        const k = r.stage as keyof PipelineCounts
        if (k in counts) counts[k]++
      }
      return counts
    },
  })
}

export interface MyStats {
  calls_booked: number
  calls_showed: number
  calls_no_show: number
  deals_won: number
  cash_collected_cents: number
  show_rate_pct: number
  close_rate_pct: number
  aov_cents: number
}

export function useMyCloserStats(period: "today" | "week" | "month" = "today") {
  return useQuery<MyStats>({
    queryKey: ["my-closer-stats", period],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const start = periodStart(period, null)
      const [{ data: leads }, { data: outcomes }, { data: payments }] = await Promise.all([
        supabase.from("leads").select("id, stage, booked_at").gte("booked_at", start),
        supabase
          .from("call_outcomes")
          .select("id, result, occurred_at")
          .gte("occurred_at", start),
        supabase
          .from("payments")
          .select("amount_cents, paid_at, is_refund")
          .gte("paid_at", start)
          .eq("is_refund", false),
      ])
      const calls_booked = (leads ?? []).filter((l) => l.stage !== "new").length
      const calls_showed = (outcomes ?? []).filter((o) => o.result === "showed").length
      const calls_no_show = (outcomes ?? []).filter((o) => o.result === "no_show").length
      const deals_won = (outcomes ?? []).filter((o) => o.result === "closed").length
      const cash_collected_cents = (payments ?? []).reduce(
        (s, p) => s + (p.amount_cents ?? 0),
        0
      )
      const showed_total = calls_showed + calls_no_show
      const show_rate_pct =
        showed_total === 0 ? 0 : Math.round((calls_showed / showed_total) * 1000) / 10
      const close_rate_pct =
        calls_showed === 0 ? 0 : Math.round((deals_won / calls_showed) * 1000) / 10
      const aov_cents = deals_won === 0 ? 0 : Math.round(cash_collected_cents / deals_won)
      return {
        calls_booked,
        calls_showed,
        calls_no_show,
        deals_won,
        cash_collected_cents,
        show_rate_pct,
        close_rate_pct,
        aov_cents,
      }
    },
  })
}

// ─── SETTER ─────────────────────────────────────────────────────────────────

export interface MySetterStats {
  bookings: number
  shows: number
  conversions: number
  show_rate_pct: number
  conversion_rate_pct: number
}

export function useMySetterStats(period: "today" | "week" | "month" = "today") {
  return useQuery<MySetterStats>({
    queryKey: ["my-setter-stats", period],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const start = periodStart(period, null)
      const { data: leads } = await supabase
        .from("leads")
        .select("id, stage, created_at")
        .gte("created_at", start)
      const bookings = (leads ?? []).filter((l) => l.stage !== "new").length
      const shows = (leads ?? []).filter((l) =>
        ["showed", "pitched", "won", "lost"].includes(l.stage)
      ).length
      const conversions = (leads ?? []).filter((l) =>
        ["won", "active_student", "onboarding"].includes(l.stage)
      ).length
      return {
        bookings,
        shows,
        conversions,
        show_rate_pct: bookings === 0 ? 0 : Math.round((shows / bookings) * 1000) / 10,
        conversion_rate_pct:
          bookings === 0 ? 0 : Math.round((conversions / bookings) * 1000) / 10,
      }
    },
  })
}

// ─── COACH ──────────────────────────────────────────────────────────────────

export interface MyStudentRow {
  id: string
  lead_id: string
  program: string
  onboarding_status: "pending" | "in_progress" | "complete"
  enrolled_at: string
  updated_at: string
  discord_user_id: string | null
  whop_membership_id: string | null
  lead?: { full_name: string; email: string | null } | null
}

export function useMyStudents() {
  return useQuery<MyStudentRow[]>({
    queryKey: ["my-students"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("students")
        .select(
          "id, lead_id, program, onboarding_status, enrolled_at, updated_at, discord_user_id, whop_membership_id, lead:leads(full_name, email)"
        )
        .order("enrolled_at", { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as MyStudentRow[]
    },
  })
}

export function useMyStudentCounts() {
  return useQuery({
    queryKey: ["my-student-counts"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data } = await supabase.from("students").select("onboarding_status, enrolled_at")
      const now = Date.now()
      const week = 7 * 24 * 3600 * 1000
      const total = data?.length ?? 0
      const pending = (data ?? []).filter((s) => s.onboarding_status === "pending").length
      const in_progress = (data ?? []).filter(
        (s) => s.onboarding_status === "in_progress"
      ).length
      const complete = (data ?? []).filter((s) => s.onboarding_status === "complete").length
      const new_this_week = (data ?? []).filter(
        (s) => now - new Date(s.enrolled_at).getTime() < week
      ).length
      return { total, pending, in_progress, complete, new_this_week }
    },
  })
}
