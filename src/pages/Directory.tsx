import { Search, Plus } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"

export function Directory() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Directory"
        description="Every contact across leads, students, and team — searchable in one place."
        actions={
          <Button>
            <Plus className="h-4 w-4" /> Add contact
          </Button>
        }
      />
      <div className="flex flex-col gap-4 p-8">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
          <Input placeholder="Search by name, email, phone, IG handle…" className="pl-9" />
        </div>
        <Card>
          <CardContent className="p-10 text-center text-sm text-[var(--color-muted-foreground)]">
            Directory populates automatically from leads and students.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
