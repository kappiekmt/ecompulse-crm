import * as React from "react"
import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  Clock,
  GraduationCap,
  Loader2,
  PhoneOff,
  RefreshCw,
  TrendingUp,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { LeadDetailDrawer } from "@/components/leads/LeadDetailDrawer"
import { StudentDetailDrawer } from "@/components/students/StudentDetailDrawer"
import { StageBadge, stageLabel } from "@/components/leads/StageBadge"
import { useAuth } from "@/lib/auth"
import { useLeadsList, type LeadListRow } from "@/lib/queries/leads"
import { useMyTodayCalls } from "@/lib/queries/me"
import { useStudentsList, type StudentRow } from "@/lib/queries/students"
import { formatDateTime, initials } from "@/lib/utils"

const DAY = 24 * 3600 * 1000

export function CommandCenter() {
  const { profile } = useAuth()
  const role = profile?.role ?? "admin"

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Command Center"
        description={DESCRIPTION_BY_ROLE[role] ?? DESCRIPTION_BY_ROLE.admin}
      />
      <div className="grid grid-cols-1 gap-4 p-8 xl:grid-cols-2">
        {role === "closer" && <CloserPanels />}
        {role === "setter" && <SetterPanels />}
        {role === "coach" && <CoachPanels />}
        {role === "admin" && <AdminPanels />}
      </div>
    </div>
  )
}

const DESCRIPTION_BY_ROLE: Record<string, string> = {
  admin: "Things across the team that need a human right now.",
  closer: "Your pre-call queue, follow-ups, and no-shows to reschedule.",
  setter: "Today's bookings, this week's show pulse, and stuck conversations.",
  coach: "Students who need you to start their onboarding or unblock progress.",
}

// ─── Shared shell ───────────────────────────────────────────────────────────

function Panel({
  title,
  description,
  icon,
  count,
  empty,
  loading,
  children,
  tone = "default",
}: {
  title: string
  description: string
  icon: React.ReactNode
  count?: number
  empty: string
  loading?: boolean
  tone?: "default" | "warning"
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                tone === "warning"
                  ? "bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
                  : "bg-[var(--color-secondary)] text-[var(--color-foreground)]"
              }`}
            >
              {icon}
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-semibold">{title}</span>
              <span className="text-xs text-[var(--color-muted-foreground)]">{description}</span>
            </div>
          </div>
          {typeof count === "number" && (
            <Badge variant={count === 0 ? "muted" : tone === "warning" ? "warning" : "muted"}>
              {count}
            </Badge>
          )}
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-[var(--color-muted-foreground)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : count === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--color-border)] py-4 text-center text-xs text-[var(--color-muted-foreground)]">
            {empty}
          </p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  )
}

function LeadRow({
  lead,
  onClick,
  right,
}: {
  lead: LeadListRow
  onClick: () => void
  right?: React.ReactNode
}) {
  return (
    <li
      onClick={onClick}
      className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--color-secondary)]/40"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-secondary)] text-[10px] font-semibold">
        {initials(lead.full_name)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{lead.full_name}</span>
        <span className="truncate text-xs text-[var(--color-muted-foreground)]">
          {lead.email ?? "—"}
        </span>
      </div>
      {right}
      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
    </li>
  )
}

function StudentRowItem({
  student,
  onClick,
  right,
}: {
  student: StudentRow
  onClick: () => void
  right?: React.ReactNode
}) {
  return (
    <li
      onClick={onClick}
      className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--color-secondary)]/40"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-secondary)] text-[10px] font-semibold">
        {initials(student.lead?.full_name ?? "?")}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">
          {student.lead?.full_name ?? "Unknown"}
        </span>
        <span className="truncate text-xs text-[var(--color-muted-foreground)]">
          {student.program}
        </span>
      </div>
      {right}
      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
    </li>
  )
}

function ListWrap({ children }: { children: React.ReactNode }) {
  return (
    <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
      {children}
    </ul>
  )
}

// ─── Closer ─────────────────────────────────────────────────────────────────

function CloserPanels() {
  const today = useMyTodayCalls()
  const followUps = useLeadsList({ stages: ["pitched", "follow_up_short"], limit: 50 })
  const noShows = useLeadsList({ stages: ["no_show"], limit: 50 })
  const [activeId, setActiveId] = React.useState<string | null>(null)

  const preCallQueue = (today.data ?? []).filter((c) => !c.pre_call_started)
  const last48 = Date.now() - 2 * DAY
  const recentNoShows = (noShows.data ?? []).filter(
    (l) => l.scheduled_at && new Date(l.scheduled_at).getTime() > last48
  )
  const oldestFirst = [...(followUps.data ?? [])].sort(
    (a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
  )

  return (
    <>
      <Panel
        title="Pre-call SOP queue"
        description="Today's calls where the pre-call SOP hasn't been started."
        icon={<CalendarClock className="h-4 w-4" />}
        count={preCallQueue.length}
        loading={today.isLoading}
        empty="All calls today have pre-call done. Nice."
        tone={preCallQueue.length > 0 ? "warning" : "default"}
      >
        <ListWrap>
          {preCallQueue.map((c) => (
            <li
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--color-secondary)]/40"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-secondary)] text-[10px] font-semibold">
                {initials(c.full_name)}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{c.full_name}</span>
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {c.scheduled_at ? formatDateTime(c.scheduled_at) : "Time TBD"}
                </span>
              </div>
              <Badge variant="warning">Run SOP</Badge>
              <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
            </li>
          ))}
        </ListWrap>
      </Panel>

      <Panel
        title="Follow-ups due"
        description="Leads you've pitched — oldest first. Get them off the fence."
        icon={<RefreshCw className="h-4 w-4" />}
        count={oldestFirst.length}
        loading={followUps.isLoading}
        empty="Nothing pending follow-up."
      >
        <ListWrap>
          {oldestFirst.slice(0, 8).map((l) => (
            <LeadRow
              key={l.id}
              lead={l}
              onClick={() => setActiveId(l.id)}
              right={
                <>
                  <StageBadge stage={l.stage} />
                  <span className="hidden text-xs text-[var(--color-muted-foreground)] md:inline">
                    {daysAgo(l.updated_at)}d ago
                  </span>
                </>
              }
            />
          ))}
        </ListWrap>
      </Panel>

      <Panel
        title="No-shows to reschedule"
        description="Last 48h — slack/DM them and get a new slot."
        icon={<PhoneOff className="h-4 w-4" />}
        count={recentNoShows.length}
        loading={noShows.isLoading}
        empty="No recent no-shows."
        tone={recentNoShows.length > 0 ? "warning" : "default"}
      >
        <ListWrap>
          {recentNoShows.slice(0, 8).map((l) => (
            <LeadRow
              key={l.id}
              lead={l}
              onClick={() => setActiveId(l.id)}
              right={
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {l.scheduled_at ? formatDateTime(l.scheduled_at) : "—"}
                </span>
              }
            />
          ))}
        </ListWrap>
      </Panel>

      <LeadDetailDrawer leadId={activeId} onClose={() => setActiveId(null)} />
    </>
  )
}

// ─── Setter ─────────────────────────────────────────────────────────────────

function SetterPanels() {
  const todayBookings = useLeadsList({ stages: ["booked", "confirmed"], limit: 50 })
  const recentWeek = useLeadsList({ limit: 200 })
  const stuck = useLeadsList({ stages: ["new"], limit: 50 })
  const [activeId, setActiveId] = React.useState<string | null>(null)

  const todayList = (todayBookings.data ?? []).filter((l) => isToday(l.scheduled_at))
  const weekStart = Date.now() - 7 * DAY
  const recentBooked = (recentWeek.data ?? []).filter(
    (l) => l.booked_at && new Date(l.booked_at).getTime() > weekStart
  )
  const showed = recentBooked.filter((l) =>
    ["showed", "pitched", "won", "lost"].includes(l.stage)
  ).length
  const showRate = recentBooked.length === 0 ? 0 : Math.round((showed / recentBooked.length) * 100)

  const threeDaysAgo = Date.now() - 3 * DAY
  const stuckList = (stuck.data ?? []).filter(
    (l) => new Date(l.created_at).getTime() < threeDaysAgo
  )

  return (
    <>
      <Panel
        title="Today's bookings"
        description="Calls you sourced that are happening today."
        icon={<CalendarClock className="h-4 w-4" />}
        count={todayList.length}
        loading={todayBookings.isLoading}
        empty="No calls scheduled today from your sourcing."
      >
        <ListWrap>
          {todayList.map((l) => (
            <LeadRow
              key={l.id}
              lead={l}
              onClick={() => setActiveId(l.id)}
              right={
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {l.scheduled_at ? formatDateTime(l.scheduled_at) : "—"}
                </span>
              }
            />
          ))}
        </ListWrap>
      </Panel>

      <Panel
        title="This week's show pulse"
        description="Bookings made in the last 7 days and how many actually showed."
        icon={<TrendingUp className="h-4 w-4" />}
        count={recentBooked.length}
        loading={recentWeek.isLoading}
        empty="No bookings yet this week."
      >
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Booked" value={recentBooked.length.toString()} />
          <Stat label="Showed" value={showed.toString()} />
          <Stat label="Show rate" value={`${showRate}%`} />
        </div>
        <ListWrap>
          {recentBooked.slice(0, 5).map((l) => (
            <LeadRow
              key={l.id}
              lead={l}
              onClick={() => setActiveId(l.id)}
              right={<StageBadge stage={l.stage} />}
            />
          ))}
        </ListWrap>
      </Panel>

      <Panel
        title="Stuck conversations"
        description="Leads you opened 3+ days ago that never booked. Nudge or close."
        icon={<AlertTriangle className="h-4 w-4" />}
        count={stuckList.length}
        loading={stuck.isLoading}
        empty="Nothing stuck."
        tone={stuckList.length > 0 ? "warning" : "default"}
      >
        <ListWrap>
          {stuckList.slice(0, 8).map((l) => (
            <LeadRow
              key={l.id}
              lead={l}
              onClick={() => setActiveId(l.id)}
              right={
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {daysAgo(l.created_at)}d
                </span>
              }
            />
          ))}
        </ListWrap>
      </Panel>

      <LeadDetailDrawer leadId={activeId} onClose={() => setActiveId(null)} />
    </>
  )
}

// ─── Coach ──────────────────────────────────────────────────────────────────

function CoachPanels() {
  const { profile } = useAuth()
  const pending = useStudentsList({ status: "pending", coachId: profile?.id ?? null })
  const inProgress = useStudentsList({ status: "in_progress", coachId: profile?.id ?? null })
  const allMine = useStudentsList({ coachId: profile?.id ?? null })
  const [activeId, setActiveId] = React.useState<string | null>(null)

  const sevenDaysAgo = Date.now() - 7 * DAY
  const stalled = (inProgress.data ?? []).filter((s) => {
    const milestones = Array.isArray(s.onboarding_checklist) ? s.onboarding_checklist : []
    if (milestones.length === 0) return true
    const lastDone = milestones
      .map((m) => (m.completed_at ? new Date(m.completed_at).getTime() : 0))
      .reduce((a, b) => Math.max(a, b), 0)
    if (lastDone === 0) return new Date(s.enrolled_at).getTime() < sevenDaysAgo
    return lastDone < sevenDaysAgo
  })

  const newThisWeek = (allMine.data ?? []).filter(
    (s) => new Date(s.enrolled_at).getTime() > Date.now() - 7 * DAY
  )

  return (
    <>
      <Panel
        title="Pending onboarding"
        description="New students assigned to you that haven't started. Kick them off first."
        icon={<UserPlus className="h-4 w-4" />}
        count={(pending.data ?? []).length}
        loading={pending.isLoading}
        empty="No-one waiting on you."
        tone={(pending.data ?? []).length > 0 ? "warning" : "default"}
      >
        <ListWrap>
          {(pending.data ?? []).slice(0, 8).map((s) => (
            <StudentRowItem
              key={s.id}
              student={s}
              onClick={() => setActiveId(s.id)}
              right={
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  Enrolled {daysAgo(s.enrolled_at)}d ago
                </span>
              }
            />
          ))}
        </ListWrap>
      </Panel>

      <Panel
        title="Stalled milestones"
        description="In-progress students with no milestone activity in 7+ days."
        icon={<Clock className="h-4 w-4" />}
        count={stalled.length}
        loading={inProgress.isLoading}
        empty="Everyone is moving."
        tone={stalled.length > 0 ? "warning" : "default"}
      >
        <ListWrap>
          {stalled.slice(0, 8).map((s) => {
            const milestones = Array.isArray(s.onboarding_checklist) ? s.onboarding_checklist : []
            const done = milestones.filter((m) => m.completed_at).length
            return (
              <StudentRowItem
                key={s.id}
                student={s}
                onClick={() => setActiveId(s.id)}
                right={
                  <span className="text-xs text-[var(--color-muted-foreground)]">
                    {done}/{milestones.length}
                  </span>
                }
              />
            )
          })}
        </ListWrap>
      </Panel>

      <Panel
        title="New this week"
        description="Students enrolled in the last 7 days — make a great first impression."
        icon={<GraduationCap className="h-4 w-4" />}
        count={newThisWeek.length}
        loading={allMine.isLoading}
        empty="No new students this week."
      >
        <ListWrap>
          {newThisWeek.slice(0, 8).map((s) => (
            <StudentRowItem
              key={s.id}
              student={s}
              onClick={() => setActiveId(s.id)}
              right={
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {daysAgo(s.enrolled_at)}d
                </span>
              }
            />
          ))}
        </ListWrap>
      </Panel>

      <StudentDetailDrawer studentId={activeId} onClose={() => setActiveId(null)} />
    </>
  )
}

// ─── Admin ──────────────────────────────────────────────────────────────────

function AdminPanels() {
  const allLeads = useLeadsList({ limit: 500 })
  const allStudents = useStudentsList()
  const [activeLeadId, setActiveLeadId] = React.useState<string | null>(null)
  const [activeStudentId, setActiveStudentId] = React.useState<string | null>(null)

  const unassignedLeads = (allLeads.data ?? []).filter(
    (l) =>
      !l.closer_id && !["new", "lost", "cancelled"].includes(l.stage)
  )
  const unassignedStudents = (allStudents.data ?? []).filter((s) => !s.coach_id)

  const fiveDaysAgo = Date.now() - 5 * DAY
  const stuckPitched = (allLeads.data ?? []).filter(
    (l) => l.stage === "pitched" && new Date(l.updated_at).getTime() < fiveDaysAgo
  )
  const longFollowUps = (allLeads.data ?? []).filter(
    (l) => l.stage === "follow_up_long" && new Date(l.updated_at).getTime() < fiveDaysAgo
  )

  return (
    <>
      <Panel
        title="Unassigned leads"
        description="Booked / mid-pipeline leads with no closer attached."
        icon={<Users className="h-4 w-4" />}
        count={unassignedLeads.length}
        loading={allLeads.isLoading}
        empty="Every active lead has a closer."
        tone={unassignedLeads.length > 0 ? "warning" : "default"}
      >
        <ListWrap>
          {unassignedLeads.slice(0, 8).map((l) => (
            <LeadRow
              key={l.id}
              lead={l}
              onClick={() => setActiveLeadId(l.id)}
              right={<StageBadge stage={l.stage} />}
            />
          ))}
        </ListWrap>
      </Panel>

      <Panel
        title="Unassigned students"
        description="Paid customers with no coach. Onboarding is blocked until you assign one."
        icon={<UserCog className="h-4 w-4" />}
        count={unassignedStudents.length}
        loading={allStudents.isLoading}
        empty="Every student has a coach."
        tone={unassignedStudents.length > 0 ? "warning" : "default"}
      >
        <ListWrap>
          {unassignedStudents.slice(0, 8).map((s) => (
            <StudentRowItem
              key={s.id}
              student={s}
              onClick={() => setActiveStudentId(s.id)}
              right={
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {daysAgo(s.enrolled_at)}d
                </span>
              }
            />
          ))}
        </ListWrap>
      </Panel>

      <Panel
        title="Stuck deals"
        description="Pitched 5+ days ago with no movement. Decide: push or close."
        icon={<AlertTriangle className="h-4 w-4" />}
        count={stuckPitched.length}
        loading={allLeads.isLoading}
        empty="Pipeline is moving."
        tone={stuckPitched.length > 0 ? "warning" : "default"}
      >
        <ListWrap>
          {stuckPitched.slice(0, 8).map((l) => (
            <LeadRow
              key={l.id}
              lead={l}
              onClick={() => setActiveLeadId(l.id)}
              right={
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {daysAgo(l.updated_at)}d
                </span>
              }
            />
          ))}
        </ListWrap>
      </Panel>

      <Panel
        title="Long follow-ups"
        description={`Leads parked on ${stageLabel("follow_up_long")} for 5+ days — time to revive or close.`}
        icon={<RefreshCw className="h-4 w-4" />}
        count={longFollowUps.length}
        loading={allLeads.isLoading}
        empty="Nothing parked."
      >
        <ListWrap>
          {longFollowUps.slice(0, 8).map((l) => (
            <LeadRow
              key={l.id}
              lead={l}
              onClick={() => setActiveLeadId(l.id)}
              right={
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {daysAgo(l.updated_at)}d
                </span>
              }
            />
          ))}
        </ListWrap>
      </Panel>

      <LeadDetailDrawer leadId={activeLeadId} onClose={() => setActiveLeadId(null)} />
      <StudentDetailDrawer studentId={activeStudentId} onClose={() => setActiveStudentId(null)} />
    </>
  )
}

// ─── small helpers ──────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-[var(--color-border)] px-3 py-2">
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
        {label}
      </span>
      <span className="text-base font-semibold">{value}</span>
    </div>
  )
}

function daysAgo(iso: string | null | undefined): number {
  if (!iso) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY))
}

function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  )
}

