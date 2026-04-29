import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface FilterSelectProps {
  label: string
  value?: string
  onChange?: (value: string) => void
  options?: { value: string; label: string }[]
  className?: string
}

export function FilterSelect({ label, value, onChange, options = [], className }: FilterSelectProps) {
  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <select
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
        className="appearance-none rounded-full border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-1.5 pr-8 text-xs font-medium text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
    </div>
  )
}
