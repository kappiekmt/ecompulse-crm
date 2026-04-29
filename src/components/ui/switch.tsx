import { cn } from "@/lib/utils"

interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  "aria-label"?: string
  className?: string
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
  ...rest
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={rest["aria-label"]}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-[var(--color-primary)]" : "bg-[var(--color-secondary)]",
        className
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </button>
  )
}
