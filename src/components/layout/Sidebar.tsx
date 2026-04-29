import { NavLink } from "react-router-dom"
import { useAuth } from "@/lib/auth"
import { navItemsForRole } from "@/lib/nav"
import { cn, initials } from "@/lib/utils"

export function Sidebar() {
  const { profile } = useAuth()
  const role = profile?.role ?? "admin"
  const items = navItemsForRole(role)

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-card)]">
      <div className="flex h-14 items-center gap-2 border-b border-[var(--color-border)] px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-primary)] text-xs font-semibold text-[var(--color-primary-foreground)]">
          EP
        </div>
        <span className="text-sm font-semibold tracking-tight">EcomPulse CRM</span>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-[var(--color-secondary)] text-[var(--color-foreground)] font-medium"
                      : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-[var(--color-border)] p-3">
        <div className="flex items-center gap-2.5 rounded-md px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-secondary)] text-xs font-semibold">
            {initials(profile?.full_name ?? "Guest")}
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">
              {profile?.full_name ?? "Not signed in"}
            </span>
            <span className="text-xs capitalize text-[var(--color-muted-foreground)]">
              {profile?.role ?? "preview"}
            </span>
          </div>
        </div>
      </div>
    </aside>
  )
}
