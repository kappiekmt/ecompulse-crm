import { UploadCloud } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export function ImportLeads() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Import Leads"
        description="Bulk-add leads from CSV. Map columns to fields, preview rows, then commit."
      />
      <div className="flex flex-col gap-4 p-8">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 border border-dashed border-[var(--color-border)] py-14 text-center">
            <UploadCloud className="h-10 w-10 text-[var(--color-muted-foreground)]" />
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Drop CSV here, or click to browse</span>
              <span className="text-xs text-[var(--color-muted-foreground)]">
                Required columns: full_name. Optional: email, phone, instagram, utm_source, utm_campaign, notes.
              </span>
            </div>
            <Button variant="outline" size="sm">
              Choose file
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <h3 className="mb-3 text-sm font-semibold">Recent imports</h3>
            <p className="text-xs text-[var(--color-muted-foreground)]">No imports yet.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
