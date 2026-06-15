import type { TeamRole } from "@/lib/database.types"
import { ALL_ROLES, ROLE_LABELS } from "@/lib/roles"
import { cn } from "@/lib/utils"

/**
 * Multi-select role picker — toggle any combination of roles. Order follows
 * ALL_ROLES (closer, setter, coach, admin) for a stable layout.
 */
export function RoleCheckboxes({
  value,
  onChange,
  className,
}: {
  value: TeamRole[]
  onChange: (roles: TeamRole[]) => void
  className?: string
}) {
  function toggle(role: TeamRole) {
    onChange(value.includes(role) ? value.filter((r) => r !== role) : [...value, role])
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {ALL_ROLES.map((role) => {
        const checked = value.includes(role)
        return (
          <button
            key={role}
            type="button"
            onClick={() => toggle(role)}
            aria-pressed={checked}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
              checked
                ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                : "border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
            )}
          >
            {ROLE_LABELS[role]}
          </button>
        )
      })}
    </div>
  )
}
