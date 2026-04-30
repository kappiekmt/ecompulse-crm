import * as React from "react"
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { Loader2 } from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { LeadDetailDrawer } from "@/components/leads/LeadDetailDrawer"
import { useLeadsList, type LeadListRow } from "@/lib/queries/leads"
import { supabase } from "@/lib/supabase"
import { cn, formatDateTime } from "@/lib/utils"
import type { LeadStage } from "@/lib/database.types"

const PIPELINE_STAGES: { key: LeadStage; label: string }[] = [
  { key: "booked", label: "Booked" },
  { key: "confirmed", label: "Confirmed" },
  { key: "showed", label: "Showed" },
  { key: "pitched", label: "Pitched" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
]

export function Pipeline() {
  const qc = useQueryClient()
  const [activeId, setActiveId] = React.useState<string | null>(null)

  const leads = useLeadsList({
    stages: PIPELINE_STAGES.map((s) => s.key),
    sortField: "updated_at",
    sortAsc: false,
    limit: 500,
  })

  const moveLead = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: LeadStage }) => {
      const { error } = await supabase.from("leads").update({ stage }).eq("id", id)
      if (error) throw error
    },
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ["leads-list"] })
      const previous = qc.getQueriesData<LeadListRow[]>({ queryKey: ["leads-list"] })
      qc.setQueriesData<LeadListRow[]>({ queryKey: ["leads-list"] }, (old) =>
        old?.map((l) => (l.id === id ? { ...l, stage } : l)) ?? []
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous?.forEach(([key, val]) => qc.setQueryData(key, val))
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["leads-list"] })
      qc.invalidateQueries({ queryKey: ["kpi-snapshot"] })
      qc.invalidateQueries({ queryKey: ["closer-performance"] })
    },
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function onDragEnd(e: DragEndEvent) {
    const stage = e.over?.id as LeadStage | undefined
    const id = e.active?.id as string | undefined
    if (!stage || !id) return
    const lead = leads.data?.find((l) => l.id === id)
    if (!lead || lead.stage === stage) return
    moveLead.mutate({ id, stage })
  }

  const grouped = React.useMemo(() => {
    const map: Record<string, LeadListRow[]> = {}
    for (const s of PIPELINE_STAGES) map[s.key] = []
    for (const l of leads.data ?? []) {
      if (map[l.stage]) map[l.stage].push(l)
    }
    return map
  }, [leads.data])

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Pipeline"
        description="Drag cards across stages. Updates the lead instantly."
      />
      <div className="p-8">
        {leads.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="grid auto-cols-[minmax(280px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-4">
              {PIPELINE_STAGES.map((stage) => (
                <Column
                  key={stage.key}
                  stage={stage.key}
                  label={stage.label}
                  leads={grouped[stage.key] ?? []}
                  onCardClick={setActiveId}
                />
              ))}
            </div>
          </DndContext>
        )}
      </div>

      <LeadDetailDrawer leadId={activeId} onClose={() => setActiveId(null)} />
    </div>
  )
}

function Column({
  stage,
  label,
  leads,
  onCardClick,
}: {
  stage: LeadStage
  label: string
  leads: LeadListRow[]
  onCardClick: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          {label}
        </span>
        <Badge variant="muted">{leads.length}</Badge>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[280px] flex-col gap-2 rounded-md border border-dashed p-2 transition-colors",
          isOver
            ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5"
            : "border-[var(--color-border)] bg-[var(--color-muted)]/30"
        )}
      >
        {leads.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-[var(--color-muted-foreground)]">
            No leads in this stage.
          </p>
        ) : (
          leads.map((l) => <DraggableCard key={l.id} lead={l} onClick={onCardClick} />)
        )}
      </div>
    </div>
  )
}

function DraggableCard({
  lead,
  onClick,
}: {
  lead: LeadListRow
  onClick: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
  })

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        if (!isDragging) {
          e.stopPropagation()
          onClick(lead.id)
        }
      }}
      className={cn(
        "cursor-grab select-none active:cursor-grabbing",
        isDragging && "opacity-60"
      )}
    >
      <CardContent className="flex flex-col gap-1.5 p-3">
        <span className="text-sm font-medium">{lead.full_name}</span>
        {lead.email && (
          <span className="truncate text-xs text-[var(--color-muted-foreground)]">
            {lead.email}
          </span>
        )}
        <div className="flex flex-wrap gap-1">
          {lead.tags?.slice(0, 3).map((t) =>
            t.tag ? (
              <Badge
                key={t.tag_id}
                variant={(t.tag.color as never) ?? "muted"}
                className="text-[10px]"
              >
                {t.tag.name}
              </Badge>
            ) : null
          )}
        </div>
        <span className="text-[10px] text-[var(--color-muted-foreground)]">
          {lead.closer?.full_name ?? "Unassigned"} · {formatDateTime(lead.updated_at)}
        </span>
      </CardContent>
    </Card>
  )
}
