import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { initials } from "@/lib/utils"

export interface LeaderboardRow {
  id: string
  name: string
  value: number
  formattedValue: string
}

interface LeaderboardProps {
  title: string
  rows: LeaderboardRow[]
  emptyText?: string
}

export function Leaderboard({ title, rows, emptyText }: LeaderboardProps) {
  const max = Math.max(0, ...rows.map((r) => r.value))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-12 text-center text-xs text-[var(--color-muted-foreground)]">
            {emptyText ?? "No data yet."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row, idx) => {
              const pct = max === 0 ? 0 : (row.value / max) * 100
              return (
                <li key={row.id} className="flex items-center gap-3">
                  <span className="w-5 text-xs font-medium text-[var(--color-muted-foreground)]">
                    {idx + 1}
                  </span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-secondary)] text-[10px] font-semibold">
                    {initials(row.name)}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{row.name}</span>
                      <span className="text-xs font-semibold tabular-nums">
                        {row.formattedValue}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-secondary)]">
                      <div
                        className="h-full bg-[var(--color-primary)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
