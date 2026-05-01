import * as React from "react"
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  TAG_COLOR_OPTIONS,
  useDeleteLeadTag,
  useLeadTagsAll,
  useUpsertLeadTag,
  type LeadTagRow,
} from "@/lib/queries/leads"

export function LeadTags() {
  const tags = useLeadTagsAll()
  const [editing, setEditing] = React.useState<LeadTagRow | null>(null)
  const [creating, setCreating] = React.useState(false)

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Lead Tags"
        description="Define tags closers and setters can apply. Tags drive segmentation in ActiveCampaign and reports."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New tag
          </Button>
        }
      />

      <div className="p-8">
        {tags.isLoading ? (
          <div className="flex items-center justify-center py-10 text-sm text-[var(--color-muted-foreground)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading tags…
          </div>
        ) : (tags.data ?? []).length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center text-sm text-[var(--color-muted-foreground)]">
              No tags yet. Click <b>New tag</b> to create your first one.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {(tags.data ?? []).map((t) => (
              <TagCard key={t.id} tag={t} onEdit={() => setEditing(t)} />
            ))}
          </div>
        )}
      </div>

      <TagDialog
        open={creating || editing !== null}
        existing={editing}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false)
            setEditing(null)
          }
        }}
      />
    </div>
  )
}

function TagCard({ tag, onEdit }: { tag: LeadTagRow; onEdit: () => void }) {
  const remove = useDeleteLeadTag()

  function del() {
    if (!confirm(`Delete tag "${tag.name}"? This unassigns it from every lead.`)) return
    remove.mutate(tag.id)
  }

  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-5">
        <Badge variant={(tag.color as never) ?? "muted"}>{tag.name}</Badge>
        <p className="flex-1 text-sm text-[var(--color-muted-foreground)]">
          {tag.description || <span className="italic">No description</span>}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-secondary)] hover:text-[var(--color-foreground)]"
            aria-label="Edit tag"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={del}
            disabled={remove.isPending}
            className="rounded-md p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-destructive)]/10 hover:text-[var(--color-destructive)]"
            aria-label="Delete tag"
          >
            {remove.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </CardContent>
    </Card>
  )
}

function TagDialog({
  open,
  existing,
  onOpenChange,
}: {
  open: boolean
  existing: LeadTagRow | null
  onOpenChange: (open: boolean) => void
}) {
  const upsert = useUpsertLeadTag()
  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [color, setColor] = React.useState<string>("default")
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setError(null)
    setName(existing?.name ?? "")
    setDescription(existing?.description ?? "")
    setColor(existing?.color ?? "default")
  }, [open, existing])

  async function save() {
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) return setError("Name is required")
    try {
      await upsert.mutateAsync({
        id: existing?.id,
        name: trimmed,
        description: description.trim() || null,
        color,
      })
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit tag" : "New tag"}</DialogTitle>
          <DialogDescription>
            Tags appear on the lead row and can be applied from any lead drawer.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tag-name">Name</Label>
              <Input
                id="tag-name"
                placeholder="Hot, Warm, Referral…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tag-desc">Description (optional)</Label>
              <Textarea
                id="tag-desc"
                rows={2}
                placeholder="When should the team apply this tag?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tag-color">Color</Label>
              <Select
                id="tag-color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              >
                {TAG_COLOR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  Preview
                </span>
                <Badge variant={color as never}>{name.trim() || "Tag name"}</Badge>
              </div>
            </div>
            {error && (
              <p className="text-xs text-[var(--color-destructive)]">{error}</p>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={upsert.isPending}>
            {upsert.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {existing ? "Save" : "Create tag"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
