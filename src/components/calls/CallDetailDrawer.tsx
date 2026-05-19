import * as React from "react"
import {
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  Loader2,
  MessageSquare,
  Sparkles,
  Tag,
  Video,
} from "lucide-react"
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
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OUTCOME_VARIANTS, formatDuration } from "@/pages/Calls"
import {
  useCall,
  useObjections,
  useToggleActionItem,
  useToggleCallObjection,
  useUpdateCallOutcome,
} from "@/lib/queries/calls"
import { useAuth } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { formatCurrency, formatDateTime } from "@/lib/utils"
import type { CallOutcome, ObjectionCategory } from "@/lib/database.types"

interface CallDetailDrawerProps {
  callId: string | null
  onClose: () => void
}

export function CallDetailDrawer({ callId, onClose }: CallDetailDrawerProps) {
  return (
    <Sheet open={Boolean(callId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent width="720px">
        {callId && <Inner callId={callId} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

const OUTCOME_OPTIONS: { value: CallOutcome; label: string }[] = [
  { value: "pending", label: "Untagged" },
  { value: "closed_won", label: "Closed (won)" },
  { value: "follow_up", label: "Follow-up needed" },
  { value: "pitched", label: "Pitched" },
  { value: "lost", label: "Lost" },
  { value: "not_qualified", label: "Not qualified" },
  { value: "no_show", label: "No-show" },
]

const CATEGORY_LABEL: Record<ObjectionCategory, string> = {
  price: "Price",
  timing: "Timing",
  authority: "Authority",
  trust: "Trust",
  need: "Need",
  spouse: "Spouse",
  other: "Other",
}

function Inner({ callId, onClose: _onClose }: { callId: string; onClose: () => void }) {
  const { profile } = useAuth()
  const call = useCall(callId)
  const update = useUpdateCallOutcome()
  const toggleItem = useToggleActionItem()
  const toggleObjection = useToggleCallObjection()
  const objections = useObjections()

  const [outcome, setOutcome] = React.useState<CallOutcome>("pending")
  const [notes, setNotes] = React.useState("")
  const [tab, setTab] = React.useState<"summary" | "transcript" | "objections" | "ai">("summary")

  React.useEffect(() => {
    if (call.data) {
      setOutcome(call.data.outcome)
      setNotes(call.data.outcome_notes ?? "")
    }
  }, [call.data])

  if (call.isLoading) {
    return (
      <SheetBody>
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading call…
        </div>
      </SheetBody>
    )
  }
  if (!call.data) {
    return (
      <SheetBody>
        <p className="text-sm text-[var(--color-muted-foreground)]">Call not found.</p>
      </SheetBody>
    )
  }

  const c = call.data
  const cfg = OUTCOME_VARIANTS[c.outcome]
  const flagged = c.ai_review?.needs_review === true
  const attachedObjectionIds = new Set(c.objections.map((o) => o.objection?.id).filter(Boolean))

  function save() {
    if (!profile?.id) return
    update.mutate({
      callId,
      outcome,
      notes: notes.trim() || null,
      taggedBy: profile.id,
    })
  }

  const dirty = c.outcome !== outcome || (c.outcome_notes ?? "") !== notes

  return (
    <>
      <SheetHeader>
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle className="mr-2">
            {c.lead?.full_name ?? c.title ?? "Call"}
          </SheetTitle>
          <Badge variant={cfg.variant}>{cfg.label}</Badge>
          {flagged && (
            <Badge variant="warning" className="text-[10px]">
              <Sparkles className="mr-1 h-3 w-3" /> Needs review
            </Badge>
          )}
        </div>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          {c.started_at ? formatDateTime(c.started_at) : "—"} ·{" "}
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDuration(c.duration_seconds)}
          </span>
          {c.closer && <> · {c.closer.full_name}</>}
        </p>
      </SheetHeader>

      <SheetBody>
        <Card label="Recording">
          {c.fathom_share_url ? (
            <a
              href={c.fathom_share_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-accent)]"
            >
              <Video className="h-3.5 w-3.5" />
              Open in Fathom
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : c.recording_url ? (
            <a
              href={c.recording_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-accent)]"
            >
              <Video className="h-3.5 w-3.5" />
              Open recording
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <p className="text-xs text-[var(--color-muted-foreground)]">No recording link.</p>
          )}
        </Card>

        <Card label="Linked lead & deal">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {c.lead ? (
              <a
                href={`/leads?id=${c.lead.id}`}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-accent)]"
              >
                {c.lead.full_name} →
              </a>
            ) : (
              <span className="text-xs text-[var(--color-muted-foreground)]">
                Lead not matched. Add the prospect's email to a lead, or attach manually.
              </span>
            )}
            {c.deal && (
              <Badge variant="outline" className="text-[10px]">
                Deal: {formatCurrency(c.deal.amount_cents, c.deal.currency)} · {c.deal.status}
              </Badge>
            )}
          </div>
        </Card>

        <Card label="Outcome">
          <div className="flex flex-col gap-2">
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value as CallOutcome)}>
              {OUTCOME_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Textarea
              placeholder="Notes (what was the deciding factor? next step?)"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <p className="text-[11px] text-[var(--color-muted-foreground)]">
              Saving will auto-update the lead's pipeline stage.
            </p>
          </div>
        </Card>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="objections">Objections</TabsTrigger>
            <TabsTrigger value="ai">AI review</TabsTrigger>
          </TabsList>

          <TabsContent value="summary">
            {c.summary ? (
              <p className="whitespace-pre-wrap text-sm text-[var(--color-foreground)]">
                {c.summary}
              </p>
            ) : (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Fathom didn't send a summary for this call.
              </p>
            )}

            <div className="mt-4 flex flex-col gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                Action items
              </p>
              {c.action_items.length === 0 ? (
                <p className="text-xs text-[var(--color-muted-foreground)]">None.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {c.action_items.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-start gap-2 rounded-md border border-[var(--color-border)] p-2 text-sm"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          toggleItem.mutate({
                            itemId: a.id,
                            callId,
                            completed: !a.completed,
                          })
                        }
                        className="mt-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                      >
                        {a.completed ? (
                          <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" />
                        ) : (
                          <Circle className="h-4 w-4" />
                        )}
                      </button>
                      <div className="flex-1">
                        <p className={a.completed ? "line-through opacity-60" : ""}>
                          {a.description}
                        </p>
                        {(a.assignee || a.due_date) && (
                          <p className="text-[11px] text-[var(--color-muted-foreground)]">
                            {a.assignee && `→ ${a.assignee}`}
                            {a.assignee && a.due_date && " · "}
                            {a.due_date && `due ${a.due_date}`}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>

          <TabsContent value="transcript">
            {c.transcript ? (
              <div className="max-h-[420px] overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3 text-xs">
                <pre className="whitespace-pre-wrap font-sans">{c.transcript}</pre>
              </div>
            ) : c.transcript_url ? (
              <a
                href={c.transcript_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[var(--color-primary)] underline"
              >
                Open transcript →
              </a>
            ) : (
              <p className="text-xs text-[var(--color-muted-foreground)]">No transcript.</p>
            )}
          </TabsContent>

          <TabsContent value="objections">
            <p className="text-[11px] text-[var(--color-muted-foreground)]">
              Tap to tag objections raised on this call. Rolls up into the
              objection library so the team can spot patterns.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(objections.data ?? []).map((o) => {
                const attached = attachedObjectionIds.has(o.id)
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() =>
                      toggleObjection.mutate({
                        callId,
                        objectionId: o.id,
                        attach: !attached,
                      })
                    }
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                      attached
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                        : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                    }`}
                  >
                    <Tag className="h-3 w-3" />
                    {o.label}
                    <span className="opacity-60">· {CATEGORY_LABEL[o.category]}</span>
                  </button>
                )
              })}
            </div>

            {c.objections.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  Tagged ({c.objections.length})
                </p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {c.objections.map((o) => (
                    <li key={o.id} className="text-xs">
                      <span className="font-medium">{o.objection?.label}</span>
                      {o.quote && (
                        <span className="text-[var(--color-muted-foreground)]"> — "{o.quote}"</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </TabsContent>

          <TabsContent value="ai">
            {!c.ai_review ? (
              <div className="flex flex-col items-start gap-2 text-xs text-[var(--color-muted-foreground)]">
                <Sparkles className="h-4 w-4" />
                <p>
                  AI review hasn't run yet. It triggers automatically when a
                  transcript arrives from Fathom, or you can re-run it manually.
                </p>
                <Button size="sm" variant="outline" onClick={() => runReview(callId)}>
                  Run AI review
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 text-sm">
                {typeof c.ai_review.framework_score === "number" && (
                  <p>
                    <span className="text-[var(--color-muted-foreground)]">Framework score: </span>
                    <span className="font-medium">{c.ai_review.framework_score}/10</span>
                  </p>
                )}
                {c.ai_review.summary && (
                  <p className="text-sm text-[var(--color-foreground)]">{c.ai_review.summary}</p>
                )}
                {c.ai_review.strengths && c.ai_review.strengths.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-success)]">
                      Strengths
                    </p>
                    <ul className="ml-4 list-disc text-xs">
                      {c.ai_review.strengths.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {c.ai_review.improvements && c.ai_review.improvements.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-warning)]">
                      Improvements
                    </p>
                    <ul className="ml-4 list-disc text-xs">
                      {c.ai_review.improvements.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-[11px] text-[var(--color-muted-foreground)]">
                  Reviewed {c.ai_reviewed_at ? formatDateTime(c.ai_reviewed_at) : "—"}
                </p>
                <Button size="sm" variant="outline" onClick={() => runReview(callId)}>
                  Re-run AI review
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {c.outcome_tagged_at && (
          <p className="flex items-center gap-1 text-[11px] text-[var(--color-muted-foreground)]">
            <MessageSquare className="h-3 w-3" />
            Outcome tagged {formatDateTime(c.outcome_tagged_at)}
          </p>
        )}
      </SheetBody>

      <SheetFooter>
        <Button onClick={save} disabled={!dirty || update.isPending}>
          {update.isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
            </span>
          ) : (
            "Save outcome"
          )}
        </Button>
      </SheetFooter>
    </>
  )
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
        {label}
      </p>
      {children}
    </section>
  )
}

async function runReview(callId: string) {
  const { error } = await supabase.functions.invoke("review-call", { body: { call_id: callId } })
  if (error) {
    console.error("[runReview]", error)
    alert(`Failed to start review: ${error.message}`)
  } else {
    alert("AI review started — refresh in ~30s to see results.")
  }
}
