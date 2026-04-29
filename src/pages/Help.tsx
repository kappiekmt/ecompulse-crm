import { Plus } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

const SOP_CATEGORIES = [
  { name: "Pre-Call SOP", count: 0, description: "Research, message, confirmation, dossier prep." },
  { name: "On-Call SOP", count: 0, description: "Call structure, objection handling, close script." },
  { name: "Post-Call SOP", count: 0, description: "Logging outcomes, follow-up cadence, downsells." },
  { name: "Onboarding SOP", count: 0, description: "Discord, Whop, coach intro, kickoff." },
  { name: "Coach SOP", count: 0, description: "Session cadence, reporting, escalations." },
]

export function Help() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Help & SOPs"
        description="Standard operating procedures for closers, setters, and coaches. Searchable, versioned."
        actions={
          <Button>
            <Plus className="h-4 w-4" /> New SOP
          </Button>
        }
      />
      <div className="flex flex-col gap-4 p-8">
        <Input placeholder="Search SOPs and articles…" className="max-w-md" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {SOP_CATEGORIES.map((s) => (
            <Card key={s.name}>
              <CardContent className="flex flex-col gap-1.5 p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{s.name}</span>
                  <span className="text-xs text-[var(--color-muted-foreground)]">{s.count}</span>
                </div>
                <p className="text-sm text-[var(--color-muted-foreground)]">{s.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
