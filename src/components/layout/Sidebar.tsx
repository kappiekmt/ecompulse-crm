import { ChevronsUpDown, LogOut } from "lucide-react"
import { NavLink } from "react-router-dom"
import { useAuth } from "@/lib/auth"
import { navSectionsForRole } from "@/lib/nav"
import { cn, initials } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export function Sidebar() {
  const { profile, signOut, session } = useAuth()
  const role = profile?.role ?? "admin"
  const sections = navSectionsForRole(role)

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-card)]">
      <div className="flex h-14 items-center gap-2.5 border-b border-[var(--color-border)] px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-primary)] text-xs font-semibold text-[var(--color-primary-foreground)]">
          EP
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">EcomPulse</span>
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Info · CRM
          </span>
        </div>
      </div>

      <button
        type="button"
        className="mx-3 mt-3 flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-accent)]"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-[var(--color-success)] text-[10px] font-bold text-[var(--color-success-foreground)]">
            E
          </span>
          <span className="truncate text-sm font-medium">EcomPulse</span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
      </button>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-4">
          {sections.map((section, idx) => (
            <li key={section.label ?? `section-${idx}`}>
              {section.label && (
                <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  {section.label}
                </div>
              )}
              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === "/"}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                          isActive
                            ? "bg-[var(--color-secondary)] font-medium text-[var(--color-foreground)]"
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
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-[var(--color-border)] p-3">
        <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-secondary)] text-xs font-semibold">
            {initials(profile?.full_name ?? "Guest")}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">
              {profile?.full_name ?? "Not signed in"}
            </span>
            <span className="text-xs capitalize text-[var(--color-muted-foreground)]">
              {profile?.role ?? "preview"}
            </span>
          </div>
        </div>
        {session && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full justify-start text-[var(--color-muted-foreground)]"
            onClick={() => void signOut()}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        )}
      </div>
    </aside>
  )
}
