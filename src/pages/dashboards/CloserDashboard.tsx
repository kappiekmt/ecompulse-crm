import * as React from "react"
import { CalendarClock, CheckCircle2, ChevronRight, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/StatCard"
import { LeadDetailDrawer } from "@/components/leads/LeadDetailDrawer"
import { StageBadge } from "@/components/leads/StageBadge"
import { useAuth } from "@/lib/auth"
import { cn, formatCurrency } from "@/lib/utils"
import {
  useMyCloserStats,
  useMyPipelineCounts,
  useMyTodayCalls,
  type PipelineCounts,
} from "@/lib/queries/me"

const PIPELINE_STAGES: { key: keyof PipelineCounts; label: string }[] = [
  { key: "booked", label: "Booked" },
  { key: "confirmed", label: "Confirmed" },
  { key: "showed", label: "Showed" },
  { key: "pitched", label: "Pitched" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
]

export function CloserDashboard() {
  const { profile } = useAuth()
  const [period, setPeriod] = React.useState<"today" | "week" | "month">("today")
  const [activeId, setActiveId] = React.useState<string | null>(null)

  const todayCalls = useMyTodayCalls()
  const pipeline = useMyPipelineCounts()
  const stats = useMyCloserStats(period)

  return (
    <div className="flex flex-col">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-8 py-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Hey {profile?.full_name?.split(" ")[0] ?? "there"} 👋
          </h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Here's your day at a glance.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-[var(--color-border)] p-0.5">
          {(["today", "week", "month"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium capitalize transition-colors",
                period === p
                  ? "bg-[var(--color-secondary)] text-[var(--color-foreground)]"
                  : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </header>

      <div className="flex flex-col gap-6 p-8">
        {/* Today's calls — the top priority for a closer */}
        <Card>
          <CardContent className="flex flex-col gap-4 p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                  <CalendarClock className="h-4 w-4" />
                </span>
                <div className="flex flex-col">
                  <span className="text-base font-semibold">Today's calls</span>
                  <span className="text-xs text-[var(--color-muted-foreground)]">
                    Click any call to open the lead drawer.
                  </span>
                </div>
              </div>
              <Badge variant="muted">
                {todayCalls.data?.length ?? 0} scheduled
              </Badge>
            </div>

            {todayCalls.isLoading ? (
              <div className="flex items-center justify-center py-8 text-xs text-[var(--color-muted-foreground)]">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : !todayCalls.data?.length ? (
              <div className="rounded-md border border-dashed border-[var(--color-border)] py-8 text-center">
                <p className="text-sm font-medium">No calls scheduled today</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Bookings flow in here automatically from Calendly.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
                {todayCalls.data.map((c) => (
                  <li
                    key={c.id}
                    onClick={() => setActiveId(c.id)}
                    className="group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--color-muted)]/40"
                  >
                    <div className="flex w-20 shrink-0 flex-col text-xs">
                      <span className="font-medium">
                        {c.scheduled_at
                          ? new Date(c.scheduled_at).toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                            })
                          : "—"}
                      </span>
                      <span className="text-[var(--color-muted-foreground)]">
                        {c.scheduled_at
                          ? new Date(c.scheduled_at).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })
                          : ""}
                      </span>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        {c.pre_call_started && (
                          <span title="Pre-call started" className="inline-flex">
                            <CheckCircle2 className="h-3.5 w-3.5 text-[var(--color-success)]" />
                          </span>
                        )}
                        <span className="truncate text-sm font-medium">{c.full_name}</span>
                      </div>
                      <span className="truncate text-xs text-[var(--color-muted-foreground)]">
                        {c.email ?? c.phone ?? c.instagram ?? ""}
                      </span>
                    </div>
                    <StageBadge stage={c.stage} />
                    <ChevronRight className="h-4 w-4 text-[var(--color-muted-foreground)] opacity-0 transition-opacity group-hover:opacity-100" />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* My stats */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={`Cash collected · ${period}`}
            value={formatCurrency(stats.data?.cash_collected_cents ?? 0)}
          />
          <StatCard
            label={`Deals won · ${period}`}
            value={(stats.data?.deals_won ?? 0).toString()}
          />
          <StatCard
            label={`Show rate · ${period}`}
            value={`${stats.data?.show_rate_pct ?? 0}%`}
          />
          <StatCard
            label={`Close rate · ${period}`}
            value={`${stats.data?.close_rate_pct ?? 0}%`}
          />
        </div>

        {/* Detailed stats */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatCard
            label={`Calls booked · ${period}`}
            value={(stats.data?.calls_booked ?? 0).toString()}
          />
          <StatCard
            label={`Calls showed · ${period}`}
            value={`${stats.data?.calls_showed ?? 0} / ${
              (stats.data?.calls_showed ?? 0) + (stats.data?.calls_no_show ?? 0)
            }`}
          />
          <StatCard
            label={`AOV · ${period}`}
            value={formatCurrency(stats.data?.aov_cents ?? 0)}
          />
        </div>

        {/* My pipeline */}
        <Card>
          <CardContent className="flex flex-col gap-4 p-6">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-base font-semibold">My pipeline</span>
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  Counts across the leads currently assigned to you.
                </span>
              </div>
              <a href="/pipeline">
                <Button variant="outline" size="sm" type="button">
                  Open pipeline
                </Button>
              </a>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {PIPELINE_STAGES.map((s) => (
                <div
                  key={s.key}
                  className="flex flex-col gap-1 rounded-md border border-[var(--color-border)] p-3"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                    {s.label}
                  </span>
                  <span className="text-2xl font-semibold tabular-nums">
                    {pipeline.data?.[s.key] ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <LeadDetailDrawer leadId={activeId} onClose={() => setActiveId(null)} />
    </div>
  )
}
