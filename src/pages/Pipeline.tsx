import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const STAGES = [
  { key: "booked", label: "Booked", color: "muted" },
  { key: "confirmed", label: "Confirmed", color: "secondary" },
  { key: "showed", label: "Showed", color: "default" },
  { key: "pitched", label: "Pitched", color: "warning" },
  { key: "won", label: "Won", color: "success" },
] as const

export function Pipeline() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Pipeline"
        description="Drag leads through each stage. Closer view filters to your assigned calls."
      />
      <div className="p-8">
        <div className="grid auto-cols-[minmax(260px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-4">
          {STAGES.map((stage) => (
            <div key={stage.key} className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <Badge variant={stage.color as never}>{stage.label}</Badge>
                <span className="text-xs text-[var(--color-muted-foreground)]">0</span>
              </div>
              <Card className="min-h-[200px] border-dashed bg-[var(--color-muted)]/40">
                <CardContent className="p-4 text-xs text-[var(--color-muted-foreground)]">
                  No leads in this stage yet.
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
