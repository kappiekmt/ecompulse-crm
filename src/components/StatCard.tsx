import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface StatCardProps {
  label: string
  value: string | number
  delta?: { value: string; positive?: boolean }
  icon?: React.ReactNode
  className?: string
}

export function StatCard({ label, value, delta, icon, className }: StatCardProps) {
  return (
    <Card className={cn("flex-1", className)}>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
            {label}
          </span>
          <span className="text-2xl font-semibold tracking-tight">{value}</span>
          {delta && (
            <span
              className={cn(
                "text-xs font-medium",
                delta.positive
                  ? "text-[var(--color-success)]"
                  : "text-[var(--color-destructive)]"
              )}
            >
              {delta.value}
            </span>
          )}
        </div>
        {icon && (
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--color-secondary)] text-[var(--color-muted-foreground)]">
            {icon}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
