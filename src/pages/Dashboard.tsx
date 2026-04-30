import * as React from "react"
import { FileBarChart, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatCard } from "@/components/StatCard"
import {
  DateRangeFilter,
  type DateRangeKey,
} from "@/components/dashboard/DateRangeFilter"
import { FilterSelect } from "@/components/dashboard/FilterSelect"
import { LineChartCard } from "@/components/dashboard/LineChartCard"
import { Leaderboard, type LeaderboardRow } from "@/components/dashboard/Leaderboard"
import { TeamPerformance } from "@/components/dashboard/TeamPerformance"
import { useAuth } from "@/lib/auth"
import { formatCurrency } from "@/lib/utils"
import {
  bucketMetrics,
  useCloserPerformance,
  useDailyMetrics,
  useKpiSnapshot,
  useSetterPerformance,
  useTeamMembers,
} from "@/lib/queries/dashboard"

export function Dashboard() {
  const { profile } = useAuth()
  const [range, setRange] = React.useState<DateRangeKey>("all")
  const [closer, setCloser] = React.useState("")
  const [setter, setSetter] = React.useState("")

  const kpi = useKpiSnapshot()
  const daily = useDailyMetrics()
  const closers = useCloserPerformance()
  const setters = useSetterPerformance()
  const closerOptions = useTeamMembers("closer")
  const setterOptions = useTeamMembers("setter")

  const monthlyCash = React.useMemo(
    () => bucketMetrics(daily.data ?? [], "month", "cash_collected_cents", 12),
    [daily.data]
  )
  const weeklyOrder = React.useMemo(
    () => bucketMetrics(daily.data ?? [], "week", "order_value_cents", 12),
    [daily.data]
  )
  const weeklyCash = React.useMemo(
    () => bucketMetrics(daily.data ?? [], "week", "cash_collected_cents", 12),
    [daily.data]
  )

  const leaderboardRows: LeaderboardRow[] = (closers.data ?? [])
    .filter((c) => c.cash_collected_cents > 0)
    .slice(0, 5)
    .map((c) => ({
      id: c.closer_id,
      name: c.full_name,
      value: c.cash_collected_cents,
      formattedValue: formatCurrency(c.cash_collected_cents),
    }))

  const teamCloserRows = (closers.data ?? []).map((c) => ({
    id: c.closer_id,
    name: c.full_name,
    callsBooked: c.calls_booked,
    showRate: c.show_rate_pct,
    closeRate: c.close_rate_pct,
    cashCollected: formatCurrency(c.cash_collected_cents),
  }))

  const teamSetterRows = (setters.data ?? []).map((s) => ({
    id: s.setter_id,
    name: s.full_name,
    callsBooked: s.bookings_made,
    showRate: 0,
    closeRate: s.conversion_rate_pct,
    cashCollected: "—",
  }))

  return (
    <div className="flex flex-col">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-8 py-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Manager Dashboard</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {profile?.full_name ?? "Preview"} — overview across the EcomPulse pipeline
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button>
            <Send className="h-4 w-4" /> Send Team EOD
          </Button>
          <Button variant="outline">
            <FileBarChart className="h-4 w-4" /> Full Report
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-6 p-8">
        <div className="flex flex-wrap items-center gap-3">
          <DateRangeFilter value={range} onChange={setRange} />
          <div className="flex items-center gap-2">
            <FilterSelect
              label="All Closers"
              value={closer}
              onChange={setCloser}
              options={(closerOptions.data ?? []).map((m) => ({ value: m.id, label: m.full_name }))}
            />
            <FilterSelect
              label="All Setters"
              value={setter}
              onChange={setSetter}
              options={(setterOptions.data ?? []).map((m) => ({ value: m.id, label: m.full_name }))}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Cash Collected"
            value={formatCurrency(kpi.data?.cash_collected_cents ?? 0)}
          />
          <StatCard
            label="Order Value"
            value={formatCurrency(kpi.data?.order_value_cents ?? 0)}
          />
          <StatCard label="Calls Booked" value={(kpi.data?.calls_booked ?? 0).toString()} />
          <StatCard
            label="Show-up Rate"
            value={`${(kpi.data?.show_up_rate_pct ?? 0).toFixed(1)}%`}
          />
          <StatCard
            label="Conversion Rate"
            value={`${(kpi.data?.conversion_rate_pct ?? 0).toFixed(1)}%`}
          />
          <StatCard
            label="Cancel Rate"
            value={`${(kpi.data?.cancel_rate_pct ?? 0).toFixed(1)}%`}
          />
          <StatCard
            label="Avg Order / Call"
            value={formatCurrency(kpi.data?.avg_order_per_call_cents ?? 0)}
          />
          <StatCard
            label="Avg Order / Close"
            value={formatCurrency(kpi.data?.avg_order_per_close_cents ?? 0)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Leaderboard
            title="Leaderboard — Cash Collected"
            rows={leaderboardRows}
            emptyText={
              closers.isLoading
                ? "Loading…"
                : "No closer revenue logged yet. Cash arrives from Stripe → first deal won."
            }
          />
          <LineChartCard
            title="Cash Collected Per Month"
            data={monthlyCash.length ? monthlyCash : emptySeries(12, "month")}
            format={(v) => formatCurrency(v)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LineChartCard
            title="Order Value Per Week"
            data={weeklyOrder.length ? weeklyOrder : emptySeries(12, "week")}
            format={(v) => formatCurrency(v)}
          />
          <LineChartCard
            title="Cash Collected Per Week"
            data={weeklyCash.length ? weeklyCash : emptySeries(12, "week")}
            format={(v) => formatCurrency(v)}
          />
        </div>

        <TeamPerformance closers={teamCloserRows} setters={teamSetterRows} />
      </div>
    </div>
  )
}

function emptySeries(count: number, unit: "week" | "month") {
  const now = new Date()
  const out = [] as { label: string; value: number }[]
  for (let i = count; i >= 0; i--) {
    const d = new Date(now)
    if (unit === "week") d.setDate(now.getDate() - i * 7)
    else d.setMonth(now.getMonth() - i)
    const label =
      unit === "month"
        ? d.toLocaleDateString("en-US", { month: "short", year: "numeric" })
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    out.push({ label, value: 0 })
  }
  return out
}
