import type { TeamRole } from "@/lib/database.types"
import { ROLE_LABELS, sortRoles } from "@/lib/roles"
import { cn } from "@/lib/utils"

/**
 * Tab strip for users who hold more than one role — lets them switch which
 * role's view (dashboard / command-center panels) they're looking at.
 * Renders nothing for single-role users.
 */
export function RoleTabs({
  roles,
  value,
  onChange,
  className,
}: {
  roles: TeamRole[]
  value: TeamRole
  onChange: (role: TeamRole) => void
  className?: string
}) {
  const ordered = sortRoles(roles)
  if (ordered.length <= 1) return null

  return (
    <div
      className={cn(
        "flex items-center gap-1 border-b border-[var(--color-border)] px-8 pt-2",
        className
      )}
    >
      {ordered.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={cn(
            "rounded-t-md border-b-2 px-3.5 py-2 text-sm font-medium transition-colors",
            value === r
              ? "border-[var(--color-primary)] text-[var(--color-foreground)]"
              : "border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          )}
        >
          {ROLE_LABELS[r]}
        </button>
      ))}
    </div>
  )
}
