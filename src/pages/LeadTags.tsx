import { Plus } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const SEED_TAGS = [
  { label: "Hot", description: "Strong fit, high intent — fast follow-up.", variant: "destructive" as const },
  { label: "Warm", description: "Replied, not yet booked.", variant: "warning" as const },
  { label: "Cold", description: "Initial outreach only.", variant: "muted" as const },
  { label: "VIP", description: "High AOV, white-glove handling.", variant: "default" as const },
  { label: "Referral", description: "Came from a current student.", variant: "success" as const },
]

export function LeadTags() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Lead Tags"
        description="Define tags closers and setters can apply. Tags drive segmentation in ActiveCampaign and reports."
        actions={
          <Button>
            <Plus className="h-4 w-4" /> New tag
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-3 p-8 md:grid-cols-2">
        {SEED_TAGS.map((t) => (
          <Card key={t.label}>
            <CardContent className="flex items-start gap-3 p-5">
              <Badge variant={t.variant}>{t.label}</Badge>
              <p className="text-sm text-[var(--color-muted-foreground)]">{t.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
