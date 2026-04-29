import { MessagesSquare } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent } from "@/components/ui/card"

export function DMChat() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="DM Chat"
        description="Internal direct messages between team members, threaded by lead or topic."
      />
      <div className="flex h-[calc(100%-6rem)] gap-0 px-8 pb-8">
        <Card className="flex w-72 shrink-0 flex-col rounded-r-none">
          <CardContent className="flex-1 p-4 text-sm text-[var(--color-muted-foreground)]">
            No conversations yet.
          </CardContent>
        </Card>
        <Card className="flex flex-1 flex-col rounded-l-none border-l-0">
          <CardContent className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-sm text-[var(--color-muted-foreground)]">
            <MessagesSquare className="h-10 w-10 text-[var(--color-muted-foreground)]/40" />
            Pick a conversation to view messages.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
