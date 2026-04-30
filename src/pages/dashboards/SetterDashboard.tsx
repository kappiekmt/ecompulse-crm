import * as React from "react"
import { CalendarPlus, Loader2 } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { StatCard } from "@/components/StatCard"
import { LeadDetailDrawer } from "@/components/leads/LeadDetailDrawer"
import { StageBadge } from "@/components/leads/StageBadge"
import { useAuth } from "@/lib/auth"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import { cn, formatDateTime } from "@/lib/utils"
import { useMySetterStats } from "@/lib/queries/me"
import type { LeadStage } from "@/lib/database.types"

interface MyBooking {
  id: string
  full_name: string
  email: string | null
  stage: LeadStage
  created_at: string
  closer_id: string | null
  closer?: { full_name: string } | null
}

function useMyRecentBookings() {
  return useQuery<MyBooking[]>({
    queryKey: ["my-recent-bookings"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select(
          "id, full_name, email, stage, created_at, closer_id, closer:team_members!leads_closer_id_fkey(full_name)"
        )
        .order("created_at", { ascending: false })
        .limit(15)
      if (error) throw error
      return (data ?? []) as unknown as MyBooking[]
    },
  })
}

export function SetterDashboard() {
  const { profile } = useAuth()
  const [period, setPeriod] = React.useState<"today" | "week" | "month">("week")
  const [activeId, setActiveId] = React.useState<string | null>(null)

  const stats = useMySetterStats(period)
  const recent = useMyRecentBookings()

  return (
    <div className="flex flex-col">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-8 py-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Hey {profile?.full_name?.split(" ")[0] ?? "there"} 👋
          </h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Your bookings and how they're performing.
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={`Bookings · ${period}`}
            value={(stats.data?.bookings ?? 0).toString()}
          />
          <StatCard
            label={`Shows · ${period}`}
            value={`${stats.data?.shows ?? 0} / ${stats.data?.bookings ?? 0}`}
          />
          <StatCard
            label={`Show rate · ${period}`}
            value={`${stats.data?.show_rate_pct ?? 0}%`}
          />
          <StatCard
            label={`Conversion · ${period}`}
            value={`${stats.data?.conversion_rate_pct ?? 0}%`}
          />
        </div>

        <Card>
          <CardContent className="flex flex-col gap-4 p-6">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                <CalendarPlus className="h-4 w-4" />
              </span>
              <div className="flex flex-col">
                <span className="text-base font-semibold">Recent bookings</span>
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  Click any row to open the lead drawer.
                </span>
              </div>
            </div>

            {recent.isLoading ? (
              <div className="flex items-center justify-center py-8 text-xs text-[var(--color-muted-foreground)]">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : !recent.data?.length ? (
              <div className="rounded-md border border-dashed border-[var(--color-border)] py-8 text-center">
                <p className="text-sm font-medium">No bookings yet</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Once leads come in with you set as the setter, they'll appear here.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
                {recent.data.map((b) => (
                  <li
                    key={b.id}
                    onClick={() => setActiveId(b.id)}
                    className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--color-muted)]/40"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">{b.full_name}</span>
                      <span className="truncate text-xs text-[var(--color-muted-foreground)]">
                        {b.email ?? "—"}
                      </span>
                    </div>
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      {b.closer?.full_name ?? "Unassigned"}
                    </span>
                    <StageBadge stage={b.stage} />
                    <span className="hidden w-32 text-right text-xs text-[var(--color-muted-foreground)] md:block">
                      {formatDateTime(b.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <LeadDetailDrawer leadId={activeId} onClose={() => setActiveId(null)} />
    </div>
  )
}
