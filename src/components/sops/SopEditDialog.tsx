import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Eye, FileText, Loader2, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  SOP_CATEGORIES,
  useDeleteSop,
  useSop,
  useUpsertSop,
  type SopUpsertInput,
} from "@/lib/queries/sops"
import type { TeamRole } from "@/lib/database.types"

const ALL_ROLES: TeamRole[] = ["admin", "closer", "setter", "coach"]

interface SopEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sopId: string | null /** null = create mode */
}

export function SopEditDialog({ open, onOpenChange, sopId }: SopEditDialogProps) {
  const existing = useSop(sopId)
  const upsert = useUpsertSop()
  const remove = useDeleteSop()

  const [tab, setTab] = React.useState<"edit" | "preview">("edit")
  const [title, setTitle] = React.useState("")
  const [slug, setSlug] = React.useState("")
  const [category, setCategory] = React.useState("onboarding")
  const [description, setDescription] = React.useState("")
  const [bodyMd, setBodyMd] = React.useState("")
  const [visibleTo, setVisibleTo] = React.useState<TeamRole[]>(["admin"])
  const [pinned, setPinned] = React.useState(false)
  const [readTime, setReadTime] = React.useState("")
  const [order, setOrder] = React.useState("0")
  const [error, setError] = React.useState<string | null>(null)

  // Hydrate from existing SOP when editing.
  React.useEffect(() => {
    if (!open) return
    setTab("edit")
    setError(null)
    if (existing.data) {
      setTitle(existing.data.title)
      setSlug(existing.data.slug ?? "")
      setCategory(existing.data.category)
      setDescription(existing.data.description ?? "")
      setBodyMd(existing.data.body_md)
      setVisibleTo(existing.data.visible_to)
      setPinned(existing.data.pinned_for_onboarding)
      setReadTime(existing.data.read_time_minutes?.toString() ?? "")
      setOrder(existing.data.display_order.toString())
    } else if (sopId === null) {
      // Create mode reset
      setTitle("")
      setSlug("")
      setCategory("onboarding")
      setDescription("")
      setBodyMd("# New SOP\n\nReplace this with the content team members need.")
      setVisibleTo(["admin"])
      setPinned(false)
      setReadTime("")
      setOrder("0")
    }
  }, [open, existing.data, sopId])

  function toggleRole(role: TeamRole) {
    setVisibleTo((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    )
  }

  async function save() {
    setError(null)
    if (!title.trim()) return setError("Title is required")
    if (!bodyMd.trim()) return setError("Body is required")
    if (visibleTo.length === 0) return setError("Pick at least one role to make this visible to")
    const input: SopUpsertInput = {
      id: sopId ?? undefined,
      slug: slug.trim() || null,
      category,
      title: title.trim(),
      description: description.trim() || null,
      body_md: bodyMd,
      visible_to: visibleTo,
      pinned_for_onboarding: pinned,
      display_order: parseInt(order, 10) || 0,
      read_time_minutes: readTime ? parseInt(readTime, 10) : null,
    }
    try {
      await upsert.mutateAsync(input)
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleDelete() {
    if (!sopId) return
    if (!confirm("Delete this SOP? This is permanent.")) return
    try {
      await remove.mutateAsync(sopId)
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{sopId ? "Edit SOP" : "New SOP"}</DialogTitle>
          <DialogDescription>
            Markdown content visible to the roles you select. Pin to "Onboarding starter pack" so
            new members see it first.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="sop-title">Title</Label>
              <Input id="sop-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sop-cat">Category</Label>
              <Select id="sop-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                {SOP_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.emoji} {c.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-3 flex flex-col gap-1.5">
              <Label htmlFor="sop-desc">Short description (optional)</Label>
              <Input
                id="sop-desc"
                placeholder="One-line summary shown on the SOP card"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sop-slug">Slug</Label>
              <Input
                id="sop-slug"
                placeholder="auto-generated"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sop-rt">Read time (min)</Label>
              <Input
                id="sop-rt"
                type="number"
                min="1"
                value={readTime}
                onChange={(e) => setReadTime(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sop-ord">Display order</Label>
              <Input
                id="sop-ord"
                type="number"
                value={order}
                onChange={(e) => setOrder(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Visible to</Label>
            <div className="flex flex-wrap gap-2">
              {ALL_ROLES.map((role) => {
                const active = visibleTo.includes(role)
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => toggleRole(role)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
                      active
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                        : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:border-[var(--color-foreground)] hover:text-[var(--color-foreground)]"
                    )}
                  >
                    {role}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-start justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Pin to onboarding starter pack</span>
              <span className="text-xs text-[var(--color-muted-foreground)]">
                Featured at the top of the Help & SOPs hub for the roles in "Visible to".
              </span>
            </div>
            <Switch checked={pinned} onCheckedChange={setPinned} aria-label="Pin to onboarding" />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1 rounded-md border border-[var(--color-border)] p-0.5 self-start">
              <button
                type="button"
                onClick={() => setTab("edit")}
                className={cn(
                  "flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors",
                  tab === "edit"
                    ? "bg-[var(--color-secondary)] text-[var(--color-foreground)]"
                    : "text-[var(--color-muted-foreground)]"
                )}
              >
                <FileText className="h-3.5 w-3.5" /> Markdown
              </button>
              <button
                type="button"
                onClick={() => setTab("preview")}
                className={cn(
                  "flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors",
                  tab === "preview"
                    ? "bg-[var(--color-secondary)] text-[var(--color-foreground)]"
                    : "text-[var(--color-muted-foreground)]"
                )}
              >
                <Eye className="h-3.5 w-3.5" /> Preview
              </button>
            </div>

            {tab === "edit" ? (
              <Textarea
                rows={18}
                value={bodyMd}
                onChange={(e) => setBodyMd(e.target.value)}
                className="font-mono text-xs"
              />
            ) : (
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-4">
                <div className="prose prose-sm max-w-none [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-4 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:text-sm [&_li]:text-sm [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{bodyMd}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
        </DialogBody>

        <DialogFooter>
          {sopId && (
            <button
              type="button"
              onClick={handleDelete}
              className="mr-auto inline-flex items-center gap-1 text-xs text-[var(--color-destructive)] hover:underline"
            >
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={upsert.isPending}>
            {upsert.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {sopId ? "Save changes" : "Create SOP"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
