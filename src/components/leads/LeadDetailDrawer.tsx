import * as React from "react"
import { Loader2, Save, Tag, X } from "lucide-react"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { StageBadge, ALL_LEAD_STAGES } from "@/components/leads/StageBadge"
import { LogCallOutcomeForm } from "@/components/leads/LogCallOutcomeForm"
import {
  useLead,
  useLeadActivities,
  useLeadCallOutcomes,
  useLeadTagsAll,
  useToggleLeadTag,
  useUpdateLead,
  type LeadListRow,
} from "@/lib/queries/leads"
import { useTeamMembers } from "@/lib/queries/dashboard"
import type { LeadStage } from "@/lib/database.types"
import { formatDateTime } from "@/lib/utils"

interface LeadDetailDrawerProps {
  leadId: string | null
  onClose: () => void
}

export function LeadDetailDrawer({ leadId, onClose }: LeadDetailDrawerProps) {
  const open = Boolean(leadId)
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent width="640px">
        {leadId && <Inner leadId={leadId} />}
      </SheetContent>
    </Sheet>
  )
}

function Inner({ leadId }: { leadId: string }) {
  const lead = useLead(leadId)
  const closers = useTeamMembers("closer")
  const setters = useTeamMembers("setter")
  const allTags = useLeadTagsAll()
  const activities = useLeadActivities(leadId)
  const outcomes = useLeadCallOutcomes(leadId)
  const update = useUpdateLead()
  const toggleTag = useToggleLeadTag()

  const [draft, setDraft] = React.useState<Partial<LeadListRow>>({})
  React.useEffect(() => {
    if (lead.data) setDraft({})
  }, [lead.data?.id])

  if (lead.isLoading) {
    return (
      <SheetBody>
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading lead…
        </div>
      </SheetBody>
    )
  }
  if (!lead.data) {
    return (
      <SheetBody>
        <p className="text-sm text-[var(--color-muted-foreground)]">Lead not found.</p>
      </SheetBody>
    )
  }

  const l = lead.data
  const isDirty = Object.keys(draft).length > 0
  function setField<K extends keyof LeadListRow>(key: K, value: LeadListRow[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  async function save() {
    await update.mutateAsync({
      id: l.id,
      patch: {
        full_name: (draft.full_name as string) ?? l.full_name,
        email: (draft.email as string | null | undefined) ?? l.email,
        phone: (draft.phone as string | null | undefined) ?? l.phone,
        instagram: (draft.instagram as string | null | undefined) ?? l.instagram,
        stage: (draft.stage as LeadStage) ?? l.stage,
        closer_id: (draft.closer_id as string | null | undefined) ?? l.closer_id,
        setter_id: (draft.setter_id as string | null | undefined) ?? l.setter_id,
        notes: (draft.notes as string | null | undefined) ?? l.notes,
      },
    })
    setDraft({})
  }

  const currentTagIds = new Set(l.tags?.map((t) => t.tag_id) ?? [])

  return (
    <>
      <SheetHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <SheetTitle>{l.full_name}</SheetTitle>
            <SheetDescription>
              {l.email ?? "—"} {l.phone ? `· ${l.phone}` : ""}
            </SheetDescription>
          </div>
          <StageBadge stage={l.stage} />
        </div>
      </SheetHeader>

      <SheetBody>
        <Section title="Identity">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full name">
              <Input
                value={(draft.full_name as string | undefined) ?? l.full_name}
                onChange={(e) => setField("full_name", e.target.value)}
              />
            </Field>
            <Field label="Stage">
              <Select
                value={(draft.stage as string | undefined) ?? l.stage}
                onChange={(e) => setField("stage", e.target.value as LeadStage)}
              >
                {ALL_LEAD_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={(draft.email as string | undefined) ?? l.email ?? ""}
                onChange={(e) => setField("email", e.target.value || null)}
              />
            </Field>
            <Field label="Phone">
              <Input
                value={(draft.phone as string | undefined) ?? l.phone ?? ""}
                onChange={(e) => setField("phone", e.target.value || null)}
              />
            </Field>
            <Field label="Instagram">
              <Input
                value={(draft.instagram as string | undefined) ?? l.instagram ?? ""}
                onChange={(e) => setField("instagram", e.target.value || null)}
              />
            </Field>
            <Field label="Closer">
              <Select
                value={(draft.closer_id as string | undefined) ?? l.closer_id ?? ""}
                onChange={(e) => setField("closer_id", e.target.value || null)}
              >
                <option value="">— Unassigned —</option>
                {(closers.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Setter">
              <Select
                value={(draft.setter_id as string | undefined) ?? l.setter_id ?? ""}
                onChange={(e) => setField("setter_id", e.target.value || null)}
              >
                <option value="">— Unassigned —</option>
                {(setters.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="UTM source">
              <Input value={l.utm_source ?? "—"} readOnly disabled />
            </Field>
          </div>
        </Section>

        <Section title="Notes">
          <Textarea
            rows={4}
            value={(draft.notes as string | undefined) ?? l.notes ?? ""}
            onChange={(e) => setField("notes", e.target.value || null)}
          />
        </Section>

        <Section
          title="Tags"
          icon={<Tag className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />}
        >
          <div className="flex flex-wrap gap-1.5">
            {(allTags.data ?? []).map((t) => {
              const active = currentTagIds.has(t.id)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() =>
                    toggleTag.mutate({ leadId: l.id, tagId: t.id, assign: !active })
                  }
                  className="cursor-pointer"
                >
                  <Badge
                    variant={
                      active
                        ? (t.color as never)
                        : "outline"
                    }
                  >
                    {active ? "✓ " : ""}
                    {t.name}
                  </Badge>
                </button>
              )
            })}
          </div>
        </Section>

        <Section title="Log a call outcome">
          <LogCallOutcomeForm leadId={l.id} closerId={l.closer_id} />
        </Section>

        <Section title="Call history">
          {outcomes.isLoading ? (
            <p className="text-xs text-[var(--color-muted-foreground)]">Loading…</p>
          ) : !outcomes.data?.length ? (
            <p className="text-xs text-[var(--color-muted-foreground)]">No call outcomes logged yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {outcomes.data.map((oo) => (
                <li
                  key={oo.id}
                  className="rounded-md border border-[var(--color-border)] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="muted" className="font-mono text-[10px]">
                      {oo.result}
                    </Badge>
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      {formatDateTime(oo.occurred_at ?? oo.created_at)}
                    </span>
                  </div>
                  {oo.reason && (
                    <div className="mt-1 text-xs">
                      <span className="font-medium">Reason:</span> {oo.reason}
                    </div>
                  )}
                  {oo.notes && (
                    <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                      {oo.notes}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Activity">
          {activities.isLoading ? (
            <p className="text-xs text-[var(--color-muted-foreground)]">Loading…</p>
          ) : !activities.data?.length ? (
            <p className="text-xs text-[var(--color-muted-foreground)]">No activity yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {activities.data.map((aa) => (
                <li
                  key={aa.id}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <code className="font-mono text-[var(--color-foreground)]">{aa.type}</code>
                  <span className="text-[var(--color-muted-foreground)]">
                    {formatDateTime(aa.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </SheetBody>

      <SheetFooter>
        {isDirty && (
          <button
            type="button"
            className="mr-auto inline-flex items-center gap-1 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            onClick={() => setDraft({})}
          >
            <X className="h-3 w-3" /> Discard changes
          </button>
        )}
        <Button onClick={save} disabled={!isDirty || update.isPending}>
          {update.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save changes
        </Button>
      </SheetFooter>
    </>
  )
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        {icon}
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          {title}
        </h3>
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}
