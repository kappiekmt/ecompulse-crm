import * as React from "react"
import { CalendarDays, Loader2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/PageHeader"
import { AutomationHealthBanner } from "@/components/AutomationHealthBanner"
import { SectionHeader } from "@/components/SectionHeader"
import { StatCard } from "@/components/StatCard"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
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

export function AdminDashboard() {
  const { profile } = useAuth()
  const [range, setRange] = React.useState<DateRangeKey>("all")
  const [closer, setCloser] = React.useState("")
  const [setter, setSetter] = React.useState("")

  const [eodSending, setEodSending] = React.useState(false)
  const [eodMsg, setEodMsg] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [eowSending, setEowSending] = React.useState(false)
  const [eowMsg, setEowMsg] = React.useState<{ ok: boolean; text: string } | null>(null)

  // Fire an EOD / EOW report to the #eod Slack channel. Both edge functions
  // share the auth + response shape; `kind` picks the path and state setters.
  async function sendReport(kind: "eod" | "eow") {
    const setSending = kind === "eod" ? setEodSending : setEowSending
    const setMsg = kind === "eod" ? setEodMsg : setEowMsg
    setSending(true)
    setMsg(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const jwt = sess.session?.access_token
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${kind}-report`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${jwt}`,
          },
          body: JSON.stringify({}),
        }
      )
      const json = await res.json()
      if (json.ok) {
        const when = kind === "eod" ? json.date : `${json.week_start}→${json.week_end}`
        setMsg({ ok: true, text: `✓ Sent to Slack (${when})` })
      } else {
        setMsg({ ok: false, text: `✗ ${json.error ?? "Failed"}` })
      }
    } catch (err) {
      setMsg({ ok: false, text: `✗ ${(err as Error).message}` })
    } finally {
      setSending(false)
      setTimeout(() => setMsg(null), 6000)
    }
  }

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
      <PageHeader
        title="Manager Dashboard"
        description={`${profile?.full_name ?? "Preview"} — overview across the EcomPulse pipeline`}
        actions={
          <>
            {(eodMsg ?? eowMsg) && (
              <span
                className={cn(
                  "text-xs font-medium",
                  (eodMsg ?? eowMsg)!.ok
                    ? "text-[var(--color-success)]"
                    : "text-[var(--color-destructive)]"
                )}
              >
                {(eodMsg ?? eowMsg)!.text}
              </span>
            )}
            {/* Convention: secondary action left, primary action right. EOW is the
                less-frequent action (weekly), EOD is the daily primary trigger. */}
            <Button variant="outline" onClick={() => sendReport("eow")} disabled={eowSending}>
              {eowSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CalendarDays className="h-4 w-4" />
              )}
              Send EOW
            </Button>
            <Button onClick={() => sendReport("eod")} disabled={eodSending}>
              {eodSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send EOD
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-6 p-8">
        <AutomationHealthBanner />
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

        {/* Revenue — money in. Visually grouped so the eye reads "cash story
            here" first, then drops down to "funnel story" next. */}
        <SectionHeader title="Revenue" caption="Money in for this period" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Cash Collected"
            value={formatCurrency(kpi.data?.cash_collected_cents ?? 0)}
          />
          <StatCard
            label="Order Value"
            value={formatCurrency(kpi.data?.order_value_cents ?? 0)}
          />
          <StatCard
            label="Avg Order / Close"
            value={formatCurrency(kpi.data?.avg_order_per_close_cents ?? 0)}
          />
          <StatCard
            label="Avg Order / Call"
            value={formatCurrency(kpi.data?.avg_order_per_call_cents ?? 0)}
          />
        </div>

        {/* Pipeline — volume + conversion through the funnel. */}
        <SectionHeader title="Pipeline" caption="Volume and conversion through the funnel" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
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
        </div>

        {/* Team — the most actionable block, promoted above the trend charts. */}
        <SectionHeader title="Team" caption="Who's converting, who's lagging" />
        <TeamPerformance closers={teamCloserRows} setters={teamSetterRows} />

        {/* Trends — info-only at the bottom. Two complementary charts (Cash
            month-over-month + Cash week-over-week). Order Value/Week was
            dropped — it duplicated the Cash chart pattern. */}
        <SectionHeader title="Trends" caption="Cash trajectory + leaderboard" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Leaderboard
            title="Leaderboard — Cash Collected"
            rows={leaderboardRows}
            emptyText={
              closers.isLoading
                ? "Loading…"
                : "No closer revenue logged yet — fills in from the first logged close."
            }
          />
          <LineChartCard
            title="Cash Collected · per week"
            data={weeklyCash.length ? weeklyCash : emptySeries(12, "week")}
            format={(v) => formatCurrency(v)}
          />
        </div>
        <LineChartCard
          title="Cash Collected · per month"
          data={monthlyCash.length ? monthlyCash : emptySeries(12, "month")}
          format={(v) => formatCurrency(v)}
        />
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
