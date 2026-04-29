import { Calendar } from "lucide-react"
import { cn } from "@/lib/utils"

export type DateRangeKey =
  | "all"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "custom"

export interface DateRangeFilterProps {
  value: DateRangeKey
  onChange: (key: DateRangeKey) => void
}

const OPTIONS: { key: DateRangeKey; label: string }[] = [
  { key: "all", label: "All Time" },
  { key: "this_week", label: "This Week" },
  { key: "last_week", label: "Last Week" },
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "custom", label: "Custom" },
]

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Calendar className="h-4 w-4 text-[var(--color-muted-foreground)]" />
      {OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
            value === opt.key
              ? "bg-[var(--color-foreground)] text-[var(--color-background)]"
              : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
