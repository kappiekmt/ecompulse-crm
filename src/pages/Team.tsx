import { Plus } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const ROLE_DESCRIPTIONS = [
  { role: "Admin", description: "Owner / ops. Full access to all data, automations, and team management." },
  { role: "Closer", description: "Runs strategy calls. Sees their assigned leads, pre-call SOPs, and personal stats." },
  { role: "Setter", description: "Books calls. Sees their bookings, attribution, and conversion to sale." },
  { role: "Coach", description: "Delivers the program. Sees only assigned students, their onboarding, and notes." },
]

export function Team() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Team"
        description="Add closers, setters, and coaches. Set roles, capacity, and commission splits."
        actions={
          <Button>
            <Plus className="h-4 w-4" /> Invite member
          </Button>
        }
      />
      <div className="flex flex-col gap-6 p-8">
        <Card>
          <CardContent className="flex flex-col gap-4 p-6">
            <h2 className="text-sm font-semibold">Role permissions</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {ROLE_DESCRIPTIONS.map((r) => (
                <div
                  key={r.role}
                  className="flex flex-col gap-1.5 rounded-md border border-[var(--color-border)] p-4"
                >
                  <Badge variant="outline">{r.role}</Badge>
                  <p className="text-sm text-[var(--color-muted-foreground)]">{r.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-10 text-center text-sm text-[var(--color-muted-foreground)]">
            No team members yet. Invite your first closer, setter, or coach.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
