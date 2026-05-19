import { Loader2, Sparkles } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useCloserCallStats } from "@/lib/queries/calls"
import { formatDuration } from "@/pages/Calls"

interface Props {
  closerId?: string | null
  heading?: string
  description?: string
}

export function CallStatsCard({ closerId, heading = "Call performance", description }: Props) {
  const stats = useCloserCallStats(closerId)

  if (stats.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-xs text-[var(--color-muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </CardContent>
      </Card>
    )
  }

  const rows = stats.data ?? []
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-xs text-[var(--color-muted-foreground)]">
          No call data yet — calls will appear here once Fathom starts syncing.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold">{heading}</p>
          {description && (
            <p className="text-xs text-[var(--color-muted-foreground)]">{description}</p>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Closer</th>
                <th className="px-3 py-2 text-right font-medium">Calls (30d)</th>
                <th className="px-3 py-2 text-right font-medium">Avg duration</th>
                <th className="px-3 py-2 text-right font-medium">Close rate</th>
                <th className="px-3 py-2 text-right font-medium">AI score</th>
                <th className="px-3 py-2 text-right font-medium">To review</th>
                <th className="px-3 py-2 text-right font-medium">Untagged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map((r) => (
                <tr key={r.closer_id}>
                  <td className="px-3 py-2 font-medium">{r.full_name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.calls_30d}</td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-[var(--color-muted-foreground)]">
                    {formatDuration(r.avg_duration_seconds)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.tagged_outcomes === 0 ? (
                      <span className="text-[var(--color-muted-foreground)]">—</span>
                    ) : (
                      <span className="font-medium">{r.close_rate_pct.toFixed(0)}%</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.avg_framework_score > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs">
                        <Sparkles className="h-3 w-3 text-[var(--color-muted-foreground)]" />
                        {r.avg_framework_score.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--color-muted-foreground)]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.needs_review > 0 ? (
                      <Badge variant="warning" className="text-[10px]">
                        {r.needs_review}
                      </Badge>
                    ) : (
                      <span className="text-xs text-[var(--color-muted-foreground)]">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.untagged_outcomes > 0 ? (
                      <Badge variant="muted" className="text-[10px]">
                        {r.untagged_outcomes}
                      </Badge>
                    ) : (
                      <span className="text-xs text-[var(--color-muted-foreground)]">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
