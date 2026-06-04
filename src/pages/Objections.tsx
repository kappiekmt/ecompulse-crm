import * as React from "react"
import { Link } from "react-router-dom"
import { MessageSquareWarning, ThumbsDown, TrendingUp } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import {
  useLossReasonRollup,
  useObjectionRollup,
  useObjections,
} from "@/lib/queries/calls"
import { useTeamMembers } from "@/lib/queries/dashboard"
import { useAuth } from "@/lib/auth"
import type { LossReasonCategory, ObjectionCategory } from "@/lib/database.types"

const LOSS_REASON_LABEL: Record<LossReasonCategory, string> = {
  price: "Price / budget",
  timing: "Timing — not now",
  authority: "Needed another decision-maker",
  trust: "Didn't believe it would work",
  no_need: "No real need / fit",
  spouse: "Spouse / partner said no",
  went_cold: "Ghosted / went cold",
  competitor: "Chose a competitor",
  other: "Other",
}

const CATEGORY_VARIANT: Record<ObjectionCategory, "muted" | "warning" | "secondary" | "destructive" | "success"> = {
  price: "warning",
  timing: "secondary",
  authority: "muted",
  trust: "destructive",
  need: "muted",
  spouse: "secondary",
  other: "muted",
}

export function Objections() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === "admin"
  const myId = profile?.id ?? null

  const [closerFilter, setCloserFilter] = React.useState("")
  const [weeks, setWeeks] = React.useState(4)
  const closers = useTeamMembers(["closer", "admin"])

  const effectiveCloserId = isAdmin ? closerFilter || null : myId

  const rollup = useObjectionRollup({
    closerId: effectiveCloserId,
    weeksBack: weeks,
  })
  const lossRollup = useLossReasonRollup({
    closerId: effectiveCloserId,
    weeksBack: weeks,
  })
  const catalog = useObjections()

  // Aggregate loss reasons across the selected window — why deals actually died.
  const lossAggregated = React.useMemo(() => {
    const map = new Map<
      LossReasonCategory,
      { total: number; exampleCallIds: string[] }
    >()
    for (const row of lossRollup.data ?? []) {
      const cur = map.get(row.lost_reason) ?? { total: 0, exampleCallIds: [] }
      cur.total += row.occurrences
      for (const id of row.example_call_ids ?? []) {
        if (cur.exampleCallIds.length < 3 && !cur.exampleCallIds.includes(id)) {
          cur.exampleCallIds.push(id)
        }
      }
      map.set(row.lost_reason, cur)
    }
    return [...map.entries()]
      .map(([reason, v]) => ({ reason, ...v }))
      .sort((a, b) => b.total - a.total)
  }, [lossRollup.data])

  // Aggregate across weeks for the "top objections" headline.
  const aggregated = React.useMemo(() => {
    const map = new Map<string, { label: string; category: ObjectionCategory; total: number; exampleCallIds: string[] }>()
    for (const row of rollup.data ?? []) {
      const cur = map.get(row.objection_id) ?? {
        label: row.label,
        category: row.category,
        total: 0,
        exampleCallIds: [],
      }
      cur.total += row.occurrences
      for (const id of row.example_call_ids ?? []) {
        if (cur.exampleCallIds.length < 3 && !cur.exampleCallIds.includes(id)) {
          cur.exampleCallIds.push(id)
        }
      }
      map.set(row.objection_id, cur)
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.total - a.total)
  }, [rollup.data])

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Objection library"
        description="What's getting in the way of closing — across calls, closers, and time."
      />

      <div className="flex flex-col gap-6 p-8">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            <Select
              className="max-w-[140px]"
              value={String(weeks)}
              onChange={(e) => setWeeks(Number(e.target.value))}
            >
              <option value="1">Last week</option>
              <option value="2">Last 2 weeks</option>
              <option value="4">Last 4 weeks</option>
              <option value="12">Last 12 weeks</option>
              <option value="52">Last year</option>
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
                  </option>
                ))}
              </Select>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {rollup.isLoading ? (
              <p className="p-10 text-center text-sm text-[var(--color-muted-foreground)]">
                Loading…
              </p>
            ) : aggregated.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-10 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-secondary)]">
                  <MessageSquareWarning className="h-5 w-5 text-[var(--color-muted-foreground)]" />
                </span>
                <p className="text-sm font-medium">No objections tagged yet.</p>
                <p className="max-w-sm text-xs text-[var(--color-muted-foreground)]">
                  Open a call from the Calls page → Objections tab to tag what
                  got in the way. They'll roll up here.
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Objection</th>
                    <th className="px-4 py-3 text-left font-medium">Category</th>
                    <th className="px-4 py-3 text-left font-medium">Occurrences</th>
                    <th className="px-4 py-3 text-left font-medium">Examples</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {aggregated.map((o) => (
                    <tr key={o.id} className="hover:bg-[var(--color-secondary)]/40">
                      <td className="px-4 py-3 font-medium">{o.label}</td>
                      <td className="px-4 py-3">
                        <Badge variant={CATEGORY_VARIANT[o.category]} className="text-[10px] capitalize">
                          {o.category}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-sm">
                          <TrendingUp className="h-3 w-3 text-[var(--color-muted-foreground)]" />
                          {o.total}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {o.exampleCallIds.length === 0 ? (
                          <span className="text-[var(--color-muted-foreground)]">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {o.exampleCallIds.map((id, i) => (
                              <Link
                                key={id}
                                to={`/calls?call=${id}`}
                                className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[11px] hover:bg-[var(--color-accent)]"
                              >
                                Call {i + 1}
                              </Link>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
              <ThumbsDown className="h-4 w-4 text-[var(--color-destructive)]" />
              <p className="text-sm font-medium">Why we're losing</p>
              <span className="text-xs text-[var(--color-muted-foreground)]">
                Primary reason logged on lost calls
              </span>
            </div>
            {lossRollup.isLoading ? (
              <p className="p-10 text-center text-sm text-[var(--color-muted-foreground)]">
                Loading…
              </p>
            ) : lossAggregated.length === 0 ? (
              <p className="p-8 text-center text-xs text-[var(--color-muted-foreground)]">
                No lost-call reasons logged yet. Mark a call "Lost" from the Calls
                page and pick why — it rolls up here.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Reason</th>
                    <th className="px-4 py-3 text-left font-medium">Lost calls</th>
                    <th className="px-4 py-3 text-left font-medium">Examples</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {lossAggregated.map((o) => (
                    <tr key={o.reason} className="hover:bg-[var(--color-secondary)]/40">
                      <td className="px-4 py-3 font-medium">
                        {LOSS_REASON_LABEL[o.reason]}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-sm">
                          <TrendingUp className="h-3 w-3 text-[var(--color-muted-foreground)]" />
                          {o.total}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {o.exampleCallIds.length === 0 ? (
                          <span className="text-[var(--color-muted-foreground)]">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {o.exampleCallIds.map((id, i) => (
                              <Link
                                key={id}
                                to={`/calls?call=${id}`}
                                className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[11px] hover:bg-[var(--color-accent)]"
                              >
                                Call {i + 1}
                              </Link>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {isAdmin && catalog.data && catalog.data.length > 0 && (
          <Card>
            <CardContent className="flex flex-col gap-2 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                Catalog ({catalog.data.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {catalog.data.map((o) => (
                  <Badge key={o.id} variant="outline" className="text-[10px]">
                    {o.label} · {o.category}
                  </Badge>
                ))}
              </div>
              <p className="text-[11px] text-[var(--color-muted-foreground)]">
                Add or rename categories in the database (table:{" "}
                <code className="rounded bg-[var(--color-muted)] px-1 py-0.5">objections</code>).
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
