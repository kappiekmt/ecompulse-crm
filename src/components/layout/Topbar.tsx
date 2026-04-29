import { Bell, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/lib/auth"

export function Topbar() {
  const { profile, signOut, session } = useAuth()

  return (
    <header className="flex h-14 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-background)] px-6">
      <div className="relative flex max-w-md flex-1 items-center">
        <Search className="absolute left-3 h-4 w-4 text-[var(--color-muted-foreground)]" />
        <Input
          placeholder="Search leads, students, deals…"
          className="pl-9 bg-[var(--color-card)]"
        />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="h-4 w-4" />
        </Button>
        {session && (
          <Button variant="outline" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        )}
        {!session && (
          <span className="text-xs text-[var(--color-muted-foreground)]">
            Preview mode {profile ? `· ${profile.role}` : ""}
          </span>
        )}
      </div>
    </header>
  )
}
