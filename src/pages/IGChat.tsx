import { AtSign } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export function IGChat() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="IG Chat"
        description="Instagram DMs piped into the CRM. Tag conversations, assign to setters, convert to leads."
        actions={<Badge variant="muted">Not connected</Badge>}
      />
      <div className="flex h-[calc(100%-6rem)] gap-0 px-8 pb-8">
        <Card className="flex w-72 shrink-0 flex-col rounded-r-none">
          <CardContent className="flex-1 p-4 text-sm text-[var(--color-muted-foreground)]">
            Connect Instagram in Integrations to see threads here.
          </CardContent>
        </Card>
        <Card className="flex flex-1 flex-col rounded-l-none border-l-0">
          <CardContent className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-sm text-[var(--color-muted-foreground)]">
            <AtSign className="h-10 w-10 text-[var(--color-muted-foreground)]/40" />
            Pick a thread to view messages.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
