import * as React from "react"
import { useSearchParams } from "react-router-dom"
import {
  Clock,
  ExternalLink,
  Headphones,
  Search,
  Sparkles,
  Video,
  X as XIcon,
} from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/StatCard"
import { CallDetailDrawer } from "@/components/calls/CallDetailDrawer"
import { useCallsList, useCallsSummary } from "@/lib/queries/calls"
import { useTeamMembers } from "@/lib/queries/dashboard"
import { useAuth } from "@/lib/auth"
import { formatCurrency, formatDateTime, initials } from "@/lib/utils"
import type { CallOutcome } from "@/lib/database.types"

export const OUTCOME_VARIANTS: Record<
  CallOutcome,
  { label: string; variant: "muted" | "warning" | "success" | "destructive" | "secondary" }
> = {
  pending:       { label: "Untagged",     variant: "muted" },
  closed_won:    { label: "Closed",       variant: "success" },
  follow_up:     { label: "Follow-up",    variant: "warning" },
  no_show:       { label: "No-show",      variant: "muted" },
  not_qualified: { label: "Not qualified", variant: "destructive" },
  pitched:       { label: "Pitched",      variant: "secondary" },
  lost:          { label: "Lost",         variant: "destructive" },
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`
  const h = Math.floor(m / 60)
  return `${h}h ${(m % 60).toString().padStart(2, "0")}m`
}

export function Calls() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === "admin"
  const myMemberId = profile?.id ?? null

  const [search, setSearch] = React.useState("")
  const [outcomeFilter, setOutcomeFilter] = React.useState<CallOutcome | "all">("all")
  const [closerFilter, setCloserFilter] = React.useState("")
  const [needsReview, setNeedsReview] = React.useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeId, setActiveId] = React.useState<string | null>(
    () => searchParams.get("call") || null
  )

  function openCall(id: string | null) {
    setActiveId(id)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (id) next.set("call", id)
        else next.delete("call")
        return next
      },
      { replace: true }
    )
  }

  const debouncedSearch = useDebounced(search, 250)
  const closers = useTeamMembers(["closer", "admin"])

  // Non-admins always see only their own calls. Admins pick from the filter.
  const effectiveCloserId = isAdmin ? closerFilter || null : myMemberId

  const calls = useCallsList({
    closerId: effectiveCloserId,
    outcome: outcomeFilter,
    search: debouncedSearch,
    needsReview,
  })
  const summary = useCallsSummary(effectiveCloserId)

  return (
    <div className="flex flex-col">
      <PageHeader
        title={isAdmin ? "Calls" : "My calls"}
        description={
          isAdmin
            ? "Every recorded sales call, summary, and outcome — across the team."
            : "Your recorded calls, summaries, and outcomes."
        }
      />

      <div className="flex flex-col gap-6 p-8">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Total calls" value={(summary.data?.total ?? 0).toString()} />
          <StatCard
            label="Untagged outcome"
            value={(summary.data?.pending_outcome ?? 0).toString()}
          />
          <StatCard label="Closed" value={(summary.data?.closed_won ?? 0).toString()} />
          <StatCard
            label="Flagged for review"
            value={(summary.data?.needs_review ?? 0).toString()}
          />
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            <div className="relative max-w-xs flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
              <Input
                placeholder="Search lead, email, summary…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select
              className="max-w-[180px]"
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value as CallOutcome | "all")}
            >
              <option value="all">All outcomes</option>
              <option value="pending">Untagged</option>
              <option value="closed_won">Closed</option>
              <option value="follow_up">Follow-up</option>
              <option value="pitched">Pitched</option>
              <option value="lost">Lost</option>
              <option value="not_qualified">Not qualified</option>
              <option value="no_show">No-show</option>
            </Select>
            {isAdmin && (
              <Select
                className="max-w-[200px]"
                value={closerFilter}
                onChange={(e) => setCloserFilter(e.target.value)}
              >
                <option value="">All closers</option>
                {(closers.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                    {c.role === "admin" ? " (admin)" : ""}
                  </option>
                ))}
              </Select>
            )}
            <button
              type="button"
              onClick={() => setNeedsReview((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                needsReview
                  ? "border-[var(--color-warning)] bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
                  : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              }`}
            >
              <Sparkles className="h-3 w-3" />
              Needs review
              {needsReview && <XIcon className="h-3 w-3" />}
            </button>
            {calls.data && (
              <span className="ml-auto text-xs text-[var(--color-muted-foreground)]">
                {calls.data.length} result{calls.data.length === 1 ? "" : "s"}
              </span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {calls.isLoading ? (
              <p className="p-10 text-center text-sm text-[var(--color-muted-foreground)]">
                Loading…
              </p>
            ) : (calls.data ?? []).length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-10 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-secondary)]">
                  <Headphones className="h-5 w-5 text-[var(--color-muted-foreground)]" />
                </span>
                <p className="text-sm font-medium">No calls yet.</p>
                <p className="max-w-sm text-xs text-[var(--color-muted-foreground)]">
                  Calls show up here automatically once Fathom's webhook is wired
                  to <code className="rounded bg-[var(--color-muted)] px-1 py-0.5">/api/webhooks/fathom</code>.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Prospect</th>
                      <th className="px-4 py-3 text-left font-medium">Closer</th>
                      <th className="px-4 py-3 text-left font-medium">When</th>
                      <th className="px-4 py-3 text-left font-medium">Duration</th>
                      <th className="px-4 py-3 text-left font-medium">Outcome</th>
                      <th className="px-4 py-3 text-left font-medium">Deal</th>
                      <th className="px-4 py-3 text-left font-medium">Summary</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {(calls.data ?? []).map((c) => {
                      const cfg = OUTCOME_VARIANTS[c.outcome]
                      const flagged = c.ai_review?.needs_review === true
                      return (
                        <tr
                          key={c.id}
                          onClick={() => openCall(c.id)}
                          className="cursor-pointer transition-colors hover:bg-[var(--color-secondary)]/40"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-secondary)] text-[10px] font-semibold">
                                {initials(c.lead?.full_name ?? c.title ?? "?")}
                              </span>
                              <div className="flex flex-col">
                                <span className="font-medium">
                                  {c.lead?.full_name ?? c.title ?? "Unknown"}
                                </span>
                                <span className="text-xs text-[var(--color-muted-foreground)]">
                                  {c.lead?.email ?? "—"}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {c.closer?.full_name ?? (
                              <span className="text-[var(--color-muted-foreground)]">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-[var(--color-muted-foreground)]">
                            {c.started_at ? formatDateTime(c.started_at) : "—"}
                          </td>
                          <td className="px-4 py-3 text-xs text-[var(--color-muted-foreground)]">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDuration(c.duration_seconds)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <Badge variant={cfg.variant}>{cfg.label}</Badge>
                              {flagged && (
                                <Badge variant="warning" className="text-[10px]">
                                  <Sparkles className="mr-1 h-3 w-3" />
                                  Review
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {c.deal
                              ? formatCurrency(c.deal.amount_cents, c.deal.currency)
                              : <span className="text-[var(--color-muted-foreground)]">—</span>}
                          </td>
                          <td className="px-4 py-3 max-w-[320px] text-xs text-[var(--color-muted-foreground)]">
                            <p className="line-clamp-2">{c.summary ?? "—"}</p>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {c.fathom_share_url && (
                              <a
                                href={c.fathom_share_url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                              >
                                <Video className="h-3 w-3" />
                                Open
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <CallDetailDrawer callId={activeId} onClose={() => openCall(null)} />
    </div>
  )
}

function useDebounced<T>(value: T, delay: number): T {
  const [v, setV] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

