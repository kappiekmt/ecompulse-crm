import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { CheckCircle2, Clock, Loader2, Pencil, Undo2, Users } from "lucide-react"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  SOP_CATEGORIES,
  useMarkSopRead,
  useSop,
  useSopReads,
  useUnmarkSopRead,
} from "@/lib/queries/sops"
import { useAuth } from "@/lib/auth"
import { formatDateTime } from "@/lib/utils"

interface SopDetailDrawerProps {
  sopId: string | null
  onClose: () => void
  onEdit: (sopId: string) => void
}

export function SopDetailDrawer({ sopId, onClose, onEdit }: SopDetailDrawerProps) {
  return (
    <Sheet open={Boolean(sopId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent width="720px">
        {sopId && <Inner sopId={sopId} onEdit={onEdit} />}
      </SheetContent>
    </Sheet>
  )
}

function Inner({ sopId, onEdit }: { sopId: string; onEdit: (sopId: string) => void }) {
  const { profile } = useAuth()
  const sop = useSop(sopId)
  const reads = useSopReads()
  const mark = useMarkSopRead()
  const unmark = useUnmarkSopRead()

  // Auto-mark as read after 4s of viewing (so quick-glance doesn't count).
  React.useEffect(() => {
    if (!sop.data) return
    if (reads.data?.has(sop.data.id)) return
    const t = setTimeout(() => mark.mutate(sop.data!.id), 4000)
    return () => clearTimeout(t)
  }, [sop.data?.id, reads.data])

  if (sop.isLoading) {
    return (
      <SheetBody>
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading SOP…
        </div>
      </SheetBody>
    )
  }
  if (!sop.data) {
    return (
      <SheetBody>
        <p className="text-sm text-[var(--color-muted-foreground)]">SOP not found.</p>
      </SheetBody>
    )
  }

  const s = sop.data
  const category = SOP_CATEGORIES.find((c) => c.key === s.category)
  const isRead = reads.data?.has(s.id) ?? false
  const isAdmin = profile?.role === "admin"

  return (
    <>
      <SheetHeader>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="muted">
              {category?.emoji} {category?.label ?? s.category}
            </Badge>
            {s.read_time_minutes && (
              <Badge variant="outline">
                <Clock className="mr-1 h-3 w-3" />
                {s.read_time_minutes} min read
              </Badge>
            )}
            {s.pinned_for_onboarding && (
              <Badge variant="warning">★ Onboarding</Badge>
            )}
            {isRead && (
              <Badge variant="success">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Read
              </Badge>
            )}
          </div>
          <SheetTitle>{s.title}</SheetTitle>
          {s.description && (
            <p className="text-sm text-[var(--color-muted-foreground)]">{s.description}</p>
          )}
          <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
            <Users className="h-3 w-3" />
            <span>Visible to:</span>
            {s.visible_to.map((r) => (
              <Badge key={r} variant="outline" className="text-[10px]">
                {r}
              </Badge>
            ))}
          </div>
        </div>
      </SheetHeader>

      <SheetBody>
        <div className="prose prose-sm max-w-none [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mt-0 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-6 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-4 [&_p]:text-sm [&_li]:text-sm [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:rounded [&_code]:bg-[var(--color-muted)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_pre]:rounded-md [&_pre]:bg-[var(--color-muted)] [&_pre]:p-3 [&_pre]:text-xs [&_blockquote]:border-l-4 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-[var(--color-muted-foreground)] [&_table]:w-full [&_table]:text-sm [&_table]:my-3 [&_th]:border [&_th]:border-[var(--color-border)] [&_th]:bg-[var(--color-muted)] [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_td]:border [&_td]:border-[var(--color-border)] [&_td]:px-2 [&_td]:py-1.5 [&_a]:text-[var(--color-primary)] [&_a]:underline">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.body_md}</ReactMarkdown>
        </div>
      </SheetBody>

      <SheetFooter>
        <span className="mr-auto text-xs text-[var(--color-muted-foreground)]">
          Updated {formatDateTime(s.updated_at)} · v{s.version}
        </span>
        {isRead ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => unmark.mutate(s.id)}
            disabled={unmark.isPending}
          >
            <Undo2 className="h-3.5 w-3.5" />
            Mark as unread
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => mark.mutate(s.id)}
            disabled={mark.isPending}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Mark as read
          </Button>
        )}
        {isAdmin && (
          <Button size="sm" onClick={() => onEdit(s.id)}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        )}
      </SheetFooter>
    </>
  )
}
