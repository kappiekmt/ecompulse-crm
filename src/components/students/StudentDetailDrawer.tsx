import * as React from "react"
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  Copy,
  GraduationCap,
  Hash,
  Loader2,
  Mail,
  MessageSquarePlus,
  Phone,
  Plus,
  RefreshCw,
  Trash2,
  UserCog,
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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import {
  useAddStudentNote,
  useDeleteMilestone,
  useGenerateDiscordInvite,
  useStudent,
  useStudentActivity,
  useStudentNotes,
  useToggleMilestone,
  useUpdateStudent,
  useUpsertMilestone,
  type Milestone,
  type OnboardingStatus,
  type StudentRow,
} from "@/lib/queries/students"
import { useTeamMembers } from "@/lib/queries/dashboard"
import { useAuth } from "@/lib/auth"
import { formatCurrency, formatDateTime, initials } from "@/lib/utils"

const STATUS_OPTIONS: { value: OnboardingStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In progress" },
  { value: "complete", label: "Active / Complete" },
]

const STATUS_VARIANT: Record<
  OnboardingStatus,
  { label: string; variant: "muted" | "warning" | "success" }
> = {
  pending: { label: "Onboarding pending", variant: "muted" },
  in_progress: { label: "Onboarding in progress", variant: "warning" },
  complete: { label: "Active", variant: "success" },
}

interface Props {
  studentId: string | null
  onClose: () => void
}

export function StudentDetailDrawer({ studentId, onClose }: Props) {
  return (
    <Sheet open={Boolean(studentId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent width="640px">
        {studentId && <Inner studentId={studentId} />}
      </SheetContent>
    </Sheet>
  )
}

function Inner({ studentId }: { studentId: string }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === "admin"
  const student = useStudent(studentId)
  const coaches = useTeamMembers(["coach", "admin"])
  const update = useUpdateStudent()

  if (student.isLoading) {
    return (
      <SheetBody>
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading student…
        </div>
      </SheetBody>
    )
  }
  if (!student.data) {
    return (
      <SheetBody>
        <p className="text-sm text-[var(--color-muted-foreground)]">Student not found.</p>
      </SheetBody>
    )
  }

  const s = student.data
  const cfg = STATUS_VARIANT[s.onboarding_status]
  const milestones: Milestone[] = Array.isArray(s.onboarding_checklist)
    ? s.onboarding_checklist
    : []
  const completed = milestones.filter((m) => m.completed_at).length
  const progressPct =
    milestones.length === 0 ? 0 : Math.round((completed / milestones.length) * 100)

  return (
    <>
      <SheetHeader>
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--color-secondary)] text-sm font-semibold">
              {initials(s.lead?.full_name ?? "?")}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <SheetTitle className="truncate">{s.lead?.full_name ?? "Unknown student"}</SheetTitle>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                {s.lead?.email && (
                  <span className="inline-flex items-center gap-1">
                    <Mail className="h-3 w-3" /> {s.lead.email}
                  </span>
                )}
                {s.lead?.phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {s.lead.phone}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant={cfg.variant}>{cfg.label}</Badge>
                <Badge variant="outline">
                  <GraduationCap className="mr-1 h-3 w-3" />
                  {s.program}
                </Badge>
                {s.coach && (
                  <Badge variant="muted">
                    <UserCog className="mr-1 h-3 w-3" />
                    {s.coach.full_name}
                  </Badge>
                )}
                {!s.coach && <Badge variant="warning">Unassigned</Badge>}
              </div>
            </div>
          </div>
        </div>
      </SheetHeader>

      <SheetBody>
        <div className="flex flex-col gap-6">
          {/* Snapshot */}
          <Section title="Snapshot">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <Field label="Enrolled">
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  {formatDateTime(s.enrolled_at)}
                </span>
              </Field>
              <Field label="Deal value">
                {s.deal?.amount_cents
                  ? formatCurrency(s.deal.amount_cents, s.deal.currency ?? "EUR")
                  : "—"}
              </Field>
              <Field label="Discord user">{s.discord_user_id ?? "—"}</Field>
              <Field label="Whop">{s.whop_membership_id ?? "—"}</Field>
            </div>
          </Section>

          {/* Discord invite */}
          <Section title="Discord access">
            <DiscordInvitePanel student={s} />
          </Section>

          {/* Assignment & status (admin can edit) */}
          <Section title="Assignment & status">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-muted-foreground)]">
                  Coach
                </label>
                <Select
                  value={s.coach_id ?? ""}
                  disabled={!isAdmin || update.isPending}
                  onChange={(e) =>
                    update.mutate({
                      id: s.id,
                      coach_id: e.target.value || null,
                    })
                  }
                >
                  <option value="">— Unassigned —</option>
                  {(coaches.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                      {c.role === "admin" ? " (admin)" : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-muted-foreground)]">
                  Onboarding status
                </label>
                <Select
                  value={s.onboarding_status}
                  disabled={update.isPending}
                  onChange={(e) =>
                    update.mutate({
                      id: s.id,
                      onboarding_status: e.target.value as OnboardingStatus,
                    })
                  }
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              {isAdmin && (
                <div className="col-span-2 flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--color-muted-foreground)]">
                    Program
                  </label>
                  <Input
                    defaultValue={s.program}
                    onBlur={(e) => {
                      if (e.target.value !== s.program)
                        update.mutate({ id: s.id, program: e.target.value })
                    }}
                  />
                </div>
              )}
            </div>
          </Section>

          {/* Milestones */}
          <Section
            title="Milestones"
            right={
              <span className="text-xs text-[var(--color-muted-foreground)]">
                {completed}/{milestones.length} · {progressPct}%
              </span>
            }
          >
            <ProgressBar pct={progressPct} />
            <Milestones studentId={s.id} milestones={milestones} />
          </Section>

          {/* Notes */}
          <Section title="Notes">
            <Notes studentId={s.id} />
          </Section>

          {/* Activity */}
          <Section title="Recent activity">
            <ActivityFeed studentId={s.id} />
          </Section>
        </div>
      </SheetBody>

      <SheetFooter>
        <span className="text-xs text-[var(--color-muted-foreground)]">
          Updated {formatDateTime(s.updated_at)}
        </span>
      </SheetFooter>
    </>
  )
}

function Section({
  title,
  right,
  children,
}: {
  title: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
          {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-[var(--color-border)] px-2.5 py-2">
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
        {label}
      </span>
      <span className="text-xs">{children}</span>
    </div>
  )
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-secondary)]">
      <div
        className="h-full bg-[var(--color-primary)] transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// ─── Discord invite ─────────────────────────────────────────────────────────

function DiscordInvitePanel({ student }: { student: StudentRow }) {
  const generate = useGenerateDiscordInvite()
  const [copied, setCopied] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const url = student.discord_invite_url
  const expires = student.discord_invite_expires_at
  const expired = expires ? new Date(expires).getTime() < Date.now() : false

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  function issue() {
    setError(null)
    generate.mutate(student.id, {
      onError: (err) => setError((err as Error).message),
    })
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3">
      {url && !expired ? (
        <>
          <div className="flex items-center gap-2">
            <Hash className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 truncate text-sm text-[var(--color-primary)] underline"
            >
              {url}
            </a>
            <Button size="sm" variant="outline" onClick={copy}>
              <Copy className="h-3 w-3" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="flex items-center justify-between text-[11px] text-[var(--color-muted-foreground)]">
            <span>
              {expires
                ? `Expires ${formatDateTime(expires)}`
                : "Single-use, never expires"}
            </span>
            <button
              type="button"
              onClick={issue}
              disabled={generate.isPending}
              className="inline-flex items-center gap-1 hover:text-[var(--color-foreground)]"
            >
              {generate.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Re-issue
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {expired
              ? "Last invite expired. Issue a fresh one for this student."
              : "No Discord invite generated yet. Issue one and share with the student."}
          </p>
          <Button size="sm" onClick={issue} disabled={generate.isPending}>
            {generate.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Hash className="h-3.5 w-3.5" />
            )}
            Generate Discord invite
          </Button>
        </>
      )}
      {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
    </div>
  )
}

// ─── Milestones ─────────────────────────────────────────────────────────────

function Milestones({
  studentId,
  milestones,
}: {
  studentId: string
  milestones: Milestone[]
}) {
  const upsert = useUpsertMilestone()
  const remove = useDeleteMilestone()
  const toggle = useToggleMilestone()
  const [adding, setAdding] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [date, setDate] = React.useState("")

  function add() {
    if (!title.trim()) return
    upsert.mutate(
      {
        studentId,
        milestone: {
          title: title.trim(),
          target_date: date || null,
        },
      },
      {
        onSuccess: () => {
          setTitle("")
          setDate("")
          setAdding(false)
        },
      }
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {milestones.length === 0 && !adding && (
        <p className="rounded-md border border-dashed border-[var(--color-border)] py-3 text-center text-xs text-[var(--color-muted-foreground)]">
          No milestones yet.
        </p>
      )}

      {milestones.map((m) => {
        const done = Boolean(m.completed_at)
        return (
          <div
            key={m.id}
            className="flex items-start gap-2 rounded-md border border-[var(--color-border)] px-3 py-2"
          >
            <button
              type="button"
              onClick={() =>
                toggle.mutate({
                  studentId,
                  milestoneId: m.id,
                  completed: !done,
                })
              }
              className="mt-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              aria-label={done ? "Mark incomplete" : "Mark complete"}
            >
              {done ? (
                <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" />
              ) : (
                <Circle className="h-4 w-4" />
              )}
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                className={`text-sm font-medium ${
                  done ? "line-through text-[var(--color-muted-foreground)]" : ""
                }`}
              >
                {m.title}
              </span>
              {(m.target_date || m.completed_at) && (
                <span className="text-[11px] text-[var(--color-muted-foreground)]">
                  {m.completed_at
                    ? `Done ${formatDateTime(m.completed_at)}`
                    : `Target ${m.target_date}`}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() =>
                remove.mutate({ studentId, milestoneId: m.id })
              }
              className="text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
              aria-label="Delete milestone"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}

      {adding ? (
        <div className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-2">
          <Input
            placeholder="Milestone title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="flex-1"
            />
            <Button size="sm" onClick={add} disabled={upsert.isPending}>
              {upsert.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAdding(false)
                setTitle("")
                setDate("")
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--color-border)] py-2 text-xs text-[var(--color-muted-foreground)] hover:border-[var(--color-foreground)] hover:text-[var(--color-foreground)]"
        >
          <Plus className="h-3.5 w-3.5" /> Add milestone
        </button>
      )}
    </div>
  )
}

// ─── Notes ──────────────────────────────────────────────────────────────────

function Notes({ studentId }: { studentId: string }) {
  const notes = useStudentNotes(studentId)
  const add = useAddStudentNote()
  const [body, setBody] = React.useState("")

  function submit() {
    const text = body.trim()
    if (!text) return
    add.mutate({ studentId, body: text }, { onSuccess: () => setBody("") })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5 rounded-md border border-[var(--color-border)] p-2">
        <Textarea
          rows={2}
          placeholder="Add a note about this student…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={submit}
            disabled={!body.trim() || add.isPending}
          >
            {add.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MessageSquarePlus className="h-3.5 w-3.5" />
            )}
            Post note
          </Button>
        </div>
      </div>

      {notes.isLoading ? (
        <p className="py-2 text-xs text-[var(--color-muted-foreground)]">Loading…</p>
      ) : (notes.data ?? []).length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border)] py-3 text-center text-xs text-[var(--color-muted-foreground)]">
          No notes yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(notes.data ?? []).map((n) => (
            <li
              key={n.id}
              className="flex flex-col gap-1 rounded-md border border-[var(--color-border)] px-3 py-2"
            >
              <div className="flex items-center justify-between text-[11px] text-[var(--color-muted-foreground)]">
                <span>{n.actor?.full_name ?? "Unknown"}</span>
                <span>{formatDateTime(n.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Activity feed ──────────────────────────────────────────────────────────

function ActivityFeed({ studentId }: { studentId: string }) {
  const activity = useStudentActivity(studentId)
  if (activity.isLoading)
    return <p className="py-2 text-xs text-[var(--color-muted-foreground)]">Loading…</p>
  const rows = activity.data ?? []
  if (rows.length === 0)
    return (
      <p className="rounded-md border border-dashed border-[var(--color-border)] py-3 text-center text-xs text-[var(--color-muted-foreground)]">
        Nothing logged yet.
      </p>
    )
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.slice(0, 12).map((r) => (
        <li
          key={r.id}
          className="flex items-start gap-2 rounded-md px-2 py-1 text-xs"
        >
          <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary)]" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium capitalize">{r.type.replace(/_/g, " ")}</span>
            <span className="text-[10px] text-[var(--color-muted-foreground)]">
              {r.actor?.full_name ?? "System"} · {formatDateTime(r.created_at)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}
