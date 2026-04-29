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
import { Leaderboard } from "@/components/dashboard/Leaderboard"
import { TeamPerformance } from "@/components/dashboard/TeamPerformance"
import { useAuth } from "@/lib/auth"
import { formatCurrency } from "@/lib/utils"

export function Dashboard() {
  const { profile } = useAuth()
  const [range, setRange] = React.useState<DateRangeKey>("all")
  const [closer, setCloser] = React.useState("")
  const [setter, setSetter] = React.useState("")

  // Empty placeholder series until Supabase is wired in.
  const monthlyCash = buildEmptySeries(11, "month")
  const weeklyOrder = buildEmptySeries(12, "week")
  const weeklyCash = buildEmptySeries(12, "week")

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
            <FilterSelect label="All Closers" value={closer} onChange={setCloser} />
            <FilterSelect label="All Setters" value={setter} onChange={setSetter} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Cash Collected" value={formatCurrency(0)} deltaPct={0} />
          <StatCard label="Order Value" value={formatCurrency(0)} deltaPct={0} />
          <StatCard label="Calls Booked" value="0" deltaPct={0} />
          <StatCard label="Show-up Rate" value="0.0%" deltaPct={0} />
          <StatCard label="Conversion Rate" value="0.0%" deltaPct={0} />
          <StatCard label="Cancel Rate" value="0.0%" deltaPct={0} />
          <StatCard label="Avg Order / Call" value={formatCurrency(0)} />
          <StatCard label="Avg Order / Close" value={formatCurrency(0)} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Leaderboard
            title="Leaderboard — Cash Collected"
            rows={[]}
            emptyText="No closer revenue logged yet."
          />
          <LineChartCard
            title="Cash Collected Per Month"
            data={monthlyCash}
            format={(v) => formatCurrency(v * 100)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LineChartCard
            title="Order Value Per Week"
            data={weeklyOrder}
            format={(v) => formatCurrency(v * 100)}
          />
          <LineChartCard
            title="Cash Collected Per Week"
            data={weeklyCash}
            format={(v) => formatCurrency(v * 100)}
          />
        </div>

        <TeamPerformance closers={[]} setters={[]} />
      </div>
    </div>
  )
}

function buildEmptySeries(count: number, unit: "week" | "month") {
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
