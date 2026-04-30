import * as React from "react"
import {
  CheckCircle2,
  Clock,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Star,
} from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { SopDetailDrawer } from "@/components/sops/SopDetailDrawer"
import { SopEditDialog } from "@/components/sops/SopEditDialog"
import { useAuth } from "@/lib/auth"
import {
  SOP_CATEGORIES,
  useMarkSopRead,
  useSops,
  useSopReads,
  useUnmarkSopRead,
  type SopRow,
} from "@/lib/queries/sops"
import { cn } from "@/lib/utils"

export function Help() {
  const { profile } = useAuth()
  const sops = useSops()
  const reads = useSopReads()
  const [search, setSearch] = React.useState("")
  const [activeCategory, setActiveCategory] = React.useState<string | null>(null)
  const [openSopId, setOpenSopId] = React.useState<string | null>(null)
  const [editOpen, setEditOpen] = React.useState(false)
  const [editingSopId, setEditingSopId] = React.useState<string | null>(null)

  const isAdmin = profile?.role === "admin"

  const filtered = React.useMemo(() => {
    let rows = sops.data ?? []
    if (activeCategory) rows = rows.filter((s) => s.category === activeCategory)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          (s.description ?? "").toLowerCase().includes(q) ||
          s.body_md.toLowerCase().includes(q)
      )
    }
    return rows
  }, [sops.data, search, activeCategory])

  const pinnedForMe = (sops.data ?? []).filter((s) => s.pinned_for_onboarding)
  const pinnedReadCount = pinnedForMe.filter((s) => reads.data?.has(s.id)).length
  const pinnedTotal = pinnedForMe.length
  const pinnedProgressPct =
    pinnedTotal === 0 ? 0 : Math.round((pinnedReadCount / pinnedTotal) * 100)

  function openEditNew() {
    setEditingSopId(null)
    setEditOpen(true)
  }

  function openEditExisting(id: string) {
    setEditingSopId(id)
    setOpenSopId(null)
    setEditOpen(true)
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Help & SOPs"
        description="Standard operating procedures for closers, setters, and coaches. Pin SOPs to the onboarding starter pack to give new team members a guided path."
        actions={
          isAdmin ? (
            <Button onClick={openEditNew}>
              <Plus className="h-4 w-4" /> New SOP
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-6 p-8">
        {/* Welcome + onboarding progress */}
        {pinnedTotal > 0 && (
          <Card className="border-[var(--color-primary)]/20 bg-[var(--color-primary)]/5">
            <CardContent className="flex flex-col gap-4 p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-base font-semibold">
                      Welcome{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""} 👋
                    </span>
                    <span className="text-sm text-[var(--color-muted-foreground)]">
                      {profile?.role === "closer"
                        ? "Your day-1 reading list to ramp into running calls."
                        : profile?.role === "setter"
                        ? "Your day-1 reading list to start booking calls that show."
                        : profile?.role === "coach"
                        ? "Your day-1 reading list to onboard students smoothly."
                        : "The starter pack of SOPs every team member should read."}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
                  {pinnedReadCount} / {pinnedTotal} read
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-secondary)]">
                <div
                  className="h-full bg-[var(--color-primary)] transition-all"
                  style={{ width: `${pinnedProgressPct}%` }}
                />
              </div>

              {/* Starter pack list */}
              <ul className="flex flex-col gap-2">
                {pinnedForMe.map((s, idx) => (
                  <SopCard
                    key={s.id}
                    sop={s}
                    isRead={reads.data?.has(s.id) ?? false}
                    rank={idx + 1}
                    onOpen={() => setOpenSopId(s.id)}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
              <Input
                placeholder="Search SOPs by title, description, or body…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                activeCategory === null
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                  : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:border-[var(--color-foreground)]"
              )}
            >
              All
            </button>
            {SOP_CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setActiveCategory(c.key)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  activeCategory === c.key
                    ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                    : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:border-[var(--color-foreground)]"
                )}
              >
                {c.emoji} {c.label}
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Browse all */}
        {sops.isLoading ? (
          <div className="flex items-center justify-center py-12 text-sm text-[var(--color-muted-foreground)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading SOPs…
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <p className="text-sm font-medium">No SOPs match the current filters</p>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {search ? "Try a different search term." : "Pick another category or clear filters."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {filtered.map((s) => (
              <SopCardLarge
                key={s.id}
                sop={s}
                isRead={reads.data?.has(s.id) ?? false}
                onOpen={() => setOpenSopId(s.id)}
              />
            ))}
          </div>
        )}
      </div>

      <SopDetailDrawer
        sopId={openSopId}
        onClose={() => setOpenSopId(null)}
        onEdit={(id) => openEditExisting(id)}
      />
      <SopEditDialog open={editOpen} onOpenChange={setEditOpen} sopId={editingSopId} />
    </div>
  )
}

function SopCard({
  sop,
  isRead,
  rank,
  onOpen,
}: {
  sop: SopRow
  isRead: boolean
  rank: number
  onOpen: () => void
}) {
  const mark = useMarkSopRead()
  const unmark = useUnmarkSopRead()

  return (
    <li className="flex items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-3 transition-colors hover:bg-[var(--color-muted)]/40">
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          isRead
            ? "bg-[var(--color-success)]/15 text-[var(--color-success)]"
            : "bg-[var(--color-secondary)] text-[var(--color-foreground)]"
        )}
      >
        {isRead ? <CheckCircle2 className="h-4 w-4" /> : rank}
      </span>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 cursor-pointer flex-col text-left"
      >
        <span className="truncate text-sm font-medium">{sop.title}</span>
        {sop.description && (
          <span className="truncate text-xs text-[var(--color-muted-foreground)]">
            {sop.description}
          </span>
        )}
      </button>
      {sop.read_time_minutes && (
        <Badge variant="muted" className="text-[10px]">
          <Clock className="mr-1 h-3 w-3" />
          {sop.read_time_minutes}m
        </Badge>
      )}
      <Switch
        checked={isRead}
        onCheckedChange={(checked) => {
          if (checked) mark.mutate(sop.id)
          else unmark.mutate(sop.id)
        }}
        disabled={mark.isPending || unmark.isPending}
        aria-label={`Mark ${sop.title} as read`}
      />
    </li>
  )
}

function SopCardLarge({
  sop,
  isRead,
  onOpen,
}: {
  sop: SopRow
  isRead: boolean
  onOpen: () => void
}) {
  const category = SOP_CATEGORIES.find((c) => c.key === sop.category)
  const mark = useMarkSopRead()
  const unmark = useUnmarkSopRead()

  return (
    <div className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-4 transition-colors hover:bg-[var(--color-muted)]/40">
      <div className="flex w-full items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="muted">
            {category?.emoji} {category?.label ?? sop.category}
          </Badge>
          {sop.pinned_for_onboarding && (
            <Badge variant="warning">
              <Star className="mr-1 h-3 w-3" />
              Onboarding
            </Badge>
          )}
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Read
          </span>
          <Switch
            checked={isRead}
            onCheckedChange={(checked) => {
              if (checked) mark.mutate(sop.id)
              else unmark.mutate(sop.id)
            }}
            disabled={mark.isPending || unmark.isPending}
            aria-label={`Mark ${sop.title} as read`}
          />
        </label>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 cursor-pointer flex-col items-start gap-2 text-left"
      >
        <span className="text-base font-medium">{sop.title}</span>
        {sop.description && (
          <span className="line-clamp-2 text-sm text-[var(--color-muted-foreground)]">
            {sop.description}
          </span>
        )}
        <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
          {sop.read_time_minutes && (
            <>
              <Clock className="h-3 w-3" />
              {sop.read_time_minutes} min read
              <span>·</span>
            </>
          )}
          <span>
            {sop.visible_to.length} role{sop.visible_to.length === 1 ? "" : "s"}
          </span>
        </div>
      </button>
    </div>
  )
}
