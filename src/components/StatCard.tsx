import { ArrowUpRight, ArrowDownRight } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface StatCardProps {
  label: string
  value: string | number
  deltaPct?: number | null
  className?: string
}

export function StatCard({ label, value, deltaPct, className }: StatCardProps) {
  const positive = (deltaPct ?? 0) >= 0
  const showDelta = deltaPct !== undefined && deltaPct !== null

  return (
    <Card className={cn("flex-1", className)}>
      <CardContent className="flex flex-col gap-3 p-5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          {label}
        </span>
        <span className="text-3xl font-semibold tracking-tight">{value}</span>
        {showDelta && (
          <span
            className={cn(
              "flex items-center gap-1 text-xs font-medium",
              positive
                ? "text-[var(--color-success)]"
                : "text-[var(--color-destructive)]"
            )}
          >
            {positive ? (
              <ArrowUpRight className="h-3.5 w-3.5" />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5" />
            )}
            {positive ? "+" : ""}
            {deltaPct.toFixed(1)}%
          </span>
        )}
      </CardContent>
    </Card>
  )
}
