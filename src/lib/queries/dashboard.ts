import { useQuery } from "@tanstack/react-query"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"

export interface KpiSnapshot {
  cash_collected_cents: number
  order_value_cents: number
  calls_booked: number
  show_up_rate_pct: number
  conversion_rate_pct: number
  cancel_rate_pct: number
  avg_order_per_call_cents: number
  avg_order_per_close_cents: number
}

export interface DailyMetric {
  day: string
  cash_collected_cents: number
  refunds_cents: number
  calls_booked: number
  order_value_cents: number
  wins: number
  losses: number
}

export interface CloserPerformanceRow {
  closer_id: string
  full_name: string
  calls_booked: number
  calls_showed: number
  calls_pitched: number
  deals_won: number
  deals_lost: number
  cash_collected_cents: number
  show_rate_pct: number
  close_rate_pct: number
}

export interface SetterPerformanceRow {
  setter_id: string
  full_name: string
  bookings_made: number
  bookings_to_sale: number
  conversion_rate_pct: number
}

export function useKpiSnapshot() {
  return useQuery<KpiSnapshot>({
    queryKey: ["kpi-snapshot"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_snapshot_v")
        .select("*")
        .single()
      if (error) throw error
      return data as KpiSnapshot
    },
  })
}

export function useDailyMetrics() {
  return useQuery<DailyMetric[]>({
    queryKey: ["daily-metrics"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_metrics_v")
        .select("*")
        .order("day", { ascending: true })
      if (error) throw error
      return (data ?? []) as DailyMetric[]
    },
  })
}

export function useCloserPerformance() {
  return useQuery<CloserPerformanceRow[]>({
    queryKey: ["closer-performance"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("closer_performance_v")
        .select("*")
        .order("cash_collected_cents", { ascending: false })
      if (error) throw error
      return (data ?? []) as CloserPerformanceRow[]
    },
  })
}

export function useSetterPerformance() {
  return useQuery<SetterPerformanceRow[]>({
    queryKey: ["setter-performance"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("setter_performance_v")
        .select("*")
        .order("bookings_made", { ascending: false })
      if (error) throw error
      return (data ?? []) as SetterPerformanceRow[]
    },
  })
}

export interface TeamMemberOption {
  id: string
  full_name: string
  role: string
}

type TeamMemberRoleFilter = "closer" | "setter" | "coach" | "admin"

export function useTeamMembers(role?: TeamMemberRoleFilter | TeamMemberRoleFilter[]) {
  const roles = Array.isArray(role) ? role : role ? [role] : null
  return useQuery<TeamMemberOption[]>({
    queryKey: ["team-members", roles?.slice().sort().join(",") ?? "all"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      let q = supabase
        .from("team_members")
        .select("id, full_name, role")
        .eq("is_active", true)
        .order("full_name")
      if (roles && roles.length === 1) q = q.eq("role", roles[0])
      else if (roles && roles.length > 1) q = q.in("role", roles)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as TeamMemberOption[]
    },
  })
}

/**
 * Bucket daily metrics into weekly or monthly buckets, take the last `n` buckets.
 * Returns an array of { label, value } points.
 */
export function bucketMetrics(
  rows: DailyMetric[],
  unit: "week" | "month",
  field: keyof DailyMetric,
  n: number
): { label: string; value: number }[] {
  if (!rows.length) return []
  const buckets = new Map<string, { date: Date; value: number }>()

  for (const row of rows) {
    const d = new Date(row.day)
    let key: string
    let labelDate: Date
    if (unit === "month") {
      labelDate = new Date(d.getFullYear(), d.getMonth(), 1)
      key = `${labelDate.getFullYear()}-${labelDate.getMonth()}`
    } else {
      const monday = new Date(d)
      const day = monday.getDay()
      const diff = day === 0 ? -6 : 1 - day
      monday.setDate(monday.getDate() + diff)
      labelDate = monday
      key = labelDate.toISOString().slice(0, 10)
    }
    const existing = buckets.get(key)
    const value = Number(row[field] ?? 0)
    if (existing) {
      existing.value += value
    } else {
      buckets.set(key, { date: labelDate, value })
    }
  }

  const sorted = [...buckets.values()].sort((a, b) => a.date.getTime() - b.date.getTime())
  return sorted.slice(-n).map(({ date, value }) => ({
    label:
      unit === "month"
        ? date.toLocaleDateString("en-US", { month: "short", year: "numeric" })
        : date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    value,
  }))
}
