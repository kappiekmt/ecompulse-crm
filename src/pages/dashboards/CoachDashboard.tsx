import * as React from "react"
import { GraduationCap, Loader2, UserPlus } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { StatCard } from "@/components/StatCard"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/lib/auth"
import { formatDateTime, initials } from "@/lib/utils"
import { useMyStudents, useMyStudentCounts } from "@/lib/queries/me"

const STATUS_VARIANTS: Record<
  "pending" | "in_progress" | "complete",
  { label: string; variant: "muted" | "warning" | "success" }
> = {
  pending: { label: "Onboarding pending", variant: "muted" },
  in_progress: { label: "Onboarding in progress", variant: "warning" },
  complete: { label: "Active", variant: "success" },
}

export function CoachDashboard() {
  const { profile } = useAuth()
  const students = useMyStudents()
  const counts = useMyStudentCounts()

  const pendingList = (students.data ?? []).filter((s) => s.onboarding_status === "pending")
  const inProgressList = (students.data ?? []).filter(
    (s) => s.onboarding_status === "in_progress"
  )
  const completeList = (students.data ?? []).filter((s) => s.onboarding_status === "complete")

  return (
    <div className="flex flex-col">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-8 py-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Hey {profile?.full_name?.split(" ")[0] ?? "Coach"} 👋
          </h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Your students and where they are in onboarding.
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-6 p-8">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Total students"
            value={(counts.data?.total ?? 0).toString()}
          />
          <StatCard
            label="New this week"
            value={(counts.data?.new_this_week ?? 0).toString()}
          />
          <StatCard
            label="Onboarding pending"
            value={(counts.data?.pending ?? 0).toString()}
          />
          <StatCard
            label="In progress"
            value={(counts.data?.in_progress ?? 0).toString()}
          />
        </div>

        {pendingList.length > 0 && (
          <StudentSection
            title="Pending onboarding"
            description="New students who haven't started yet — kick off the onboarding for these first."
            icon={<UserPlus className="h-4 w-4" />}
            students={pendingList}
            tone="warning"
          />
        )}

        <StudentSection
          title="In progress"
          description="Students currently moving through the onboarding flow."
          icon={<GraduationCap className="h-4 w-4" />}
          students={inProgressList}
          tone="default"
          loading={students.isLoading}
        />

        {completeList.length > 0 && (
          <StudentSection
            title="Active students"
            description="Onboarded and engaged in the program."
            icon={<GraduationCap className="h-4 w-4" />}
            students={completeList}
            tone="default"
            collapsedDefault
          />
        )}
      </div>
    </div>
  )
}

function StudentSection({
  title,
  description,
  icon,
  students,
  tone,
  loading,
  collapsedDefault,
}: {
  title: string
  description: string
  icon: React.ReactNode
  students: ReturnType<typeof useMyStudents>["data"] extends infer T ? T extends Array<infer U> ? U[] : [] : []
  tone: "default" | "warning"
  loading?: boolean
  collapsedDefault?: boolean
}) {
  const [open, setOpen] = React.useState(!collapsedDefault)

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-2.5">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-md ${
                tone === "warning"
                  ? "bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
                  : "bg-[var(--color-secondary)] text-[var(--color-foreground)]"
              }`}
            >
              {icon}
            </span>
            <div className="flex flex-col">
              <span className="text-base font-semibold">{title}</span>
              <span className="text-xs text-[var(--color-muted-foreground)]">{description}</span>
            </div>
          </div>
          <Badge variant="muted">{students.length}</Badge>
        </button>

        {open &&
          (loading ? (
            <div className="flex items-center justify-center py-6 text-xs text-[var(--color-muted-foreground)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : students.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--color-border)] py-6 text-center text-xs text-[var(--color-muted-foreground)]">
              Nothing here.
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
              {students.map((s) => {
                const cfg = STATUS_VARIANTS[s.onboarding_status]
                return (
                  <li
                    key={s.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-secondary)] text-[10px] font-semibold">
                      {initials(s.lead?.full_name ?? "?")}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">
                        {s.lead?.full_name ?? "Unknown"}
                      </span>
                      <span className="truncate text-xs text-[var(--color-muted-foreground)]">
                        {s.lead?.email ?? "—"}
                      </span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {s.program}
                    </Badge>
                    <Badge variant={cfg.variant}>{cfg.label}</Badge>
                    <span className="hidden w-32 text-right text-xs text-[var(--color-muted-foreground)] md:block">
                      {formatDateTime(s.enrolled_at)}
                    </span>
                  </li>
                )
              })}
            </ul>
          ))}
      </CardContent>
    </Card>
  )
}
