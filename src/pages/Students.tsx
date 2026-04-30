import * as React from "react"
import { FlaskConical, GraduationCap, Loader2, Search, UserCog, UsersRound } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/StatCard"
import { StudentDetailDrawer } from "@/components/students/StudentDetailDrawer"
import {
  useCreateTestStudent,
  useStudentCounts,
  useStudentsList,
  type OnboardingStatus,
} from "@/lib/queries/students"
import { useTeamMembers } from "@/lib/queries/dashboard"
import { useAuth } from "@/lib/auth"
import { formatCurrency, formatDateTime, initials } from "@/lib/utils"

const STATUS_VARIANTS: Record<
  OnboardingStatus,
  { label: string; variant: "muted" | "warning" | "success" }
> = {
  pending: { label: "Pending", variant: "muted" },
  in_progress: { label: "In progress", variant: "warning" },
  complete: { label: "Active", variant: "success" },
}

export function Students() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === "admin"
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<OnboardingStatus | "all">("all")
  const [coachFilter, setCoachFilter] = React.useState("")
  const [activeId, setActiveId] = React.useState<string | null>(null)

  const debouncedSearch = useDebounced(search, 250)
  const coaches = useTeamMembers("coach")
  const students = useStudentsList({
    coachId: isAdmin ? coachFilter || null : null,
    status: statusFilter,
    search: debouncedSearch,
  })
  const counts = useStudentCounts()
  const seed = useCreateTestStudent()

  return (
    <div className="flex flex-col">
      <PageHeader
        title={isAdmin ? "Students" : "My students"}
        description={
          isAdmin
            ? "Every active enrollment, who's coaching them, and where they are in onboarding."
            : "Your students and where they are in onboarding."
        }
        actions={
          isAdmin ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => seed.mutate()}
              disabled={seed.isPending}
            >
              {seed.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FlaskConical className="h-3.5 w-3.5" />
              )}
              Add test student
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-6 p-8">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Total students" value={(counts.data?.total ?? 0).toString()} />
          <StatCard
            label="Onboarding pending"
            value={(counts.data?.pending ?? 0).toString()}
          />
          <StatCard
            label="In progress"
            value={(counts.data?.in_progress ?? 0).toString()}
          />
          <StatCard label="Active" value={(counts.data?.complete ?? 0).toString()} />
        </div>

        {isAdmin && (counts.data?.unassigned ?? 0) > 0 && (
          <Card>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-warning)]/10 text-[var(--color-warning)]">
                  <UserCog className="h-4 w-4" />
                </span>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {counts.data?.unassigned} student
                    {counts.data?.unassigned === 1 ? "" : "s"} without a coach
                  </span>
                  <span className="text-xs text-[var(--color-muted-foreground)]">
                    Assign a coach to start their onboarding.
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            <div className="relative max-w-xs flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
              <Input
                placeholder="Search name, email, program…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select
              className="max-w-[180px]"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as OnboardingStatus | "all")
              }
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In progress</option>
              <option value="complete">Active</option>
            </Select>
            {isAdmin && (
              <Select
                className="max-w-[200px]"
                value={coachFilter}
                onChange={(e) => setCoachFilter(e.target.value)}
              >
                <option value="">All coaches</option>
                {(coaches.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </Select>
            )}
            {students.data && (
              <span className="ml-auto text-xs text-[var(--color-muted-foreground)]">
                {students.data.length} result{students.data.length === 1 ? "" : "s"}
              </span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {students.isLoading ? (
              <p className="p-10 text-center text-sm text-[var(--color-muted-foreground)]">
                Loading…
              </p>
            ) : (students.data ?? []).length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-10 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-secondary)]">
                  <UsersRound className="h-5 w-5 text-[var(--color-muted-foreground)]" />
                </span>
                <p className="text-sm font-medium">No students match these filters.</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Students appear here once a lead converts via Stripe payment.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Student</th>
                      <th className="px-4 py-3 text-left font-medium">Program</th>
                      <th className="px-4 py-3 text-left font-medium">Coach</th>
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                      <th className="px-4 py-3 text-left font-medium">Progress</th>
                      <th className="px-4 py-3 text-left font-medium">Deal</th>
                      <th className="px-4 py-3 text-left font-medium">Enrolled</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {(students.data ?? []).map((s) => {
                      const cfg = STATUS_VARIANTS[s.onboarding_status]
                      const milestones = Array.isArray(s.onboarding_checklist)
                        ? s.onboarding_checklist
                        : []
                      const completed = milestones.filter((m) => m.completed_at).length
                      const pct =
                        milestones.length === 0
                          ? null
                          : Math.round((completed / milestones.length) * 100)
                      return (
                        <tr
                          key={s.id}
                          onClick={() => setActiveId(s.id)}
                          className="cursor-pointer transition-colors hover:bg-[var(--color-secondary)]/40"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-secondary)] text-[10px] font-semibold">
                                {initials(s.lead?.full_name ?? "?")}
                              </span>
                              <div className="flex flex-col">
                                <span className="font-medium">
                                  {s.lead?.full_name ?? "Unknown"}
                                </span>
                                <span className="text-xs text-[var(--color-muted-foreground)]">
                                  {s.lead?.email ?? "—"}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="text-[10px]">
                              <GraduationCap className="mr-1 h-3 w-3" />
                              {s.program}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            {s.coach ? (
                              <span className="text-sm">{s.coach.full_name}</span>
                            ) : (
                              <Badge variant="warning" className="text-[10px]">
                                Unassigned
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={cfg.variant}>{cfg.label}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            {pct === null ? (
                              <span className="text-xs text-[var(--color-muted-foreground)]">
                                —
                              </span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--color-secondary)]">
                                  <div
                                    className="h-full bg-[var(--color-primary)]"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-xs text-[var(--color-muted-foreground)]">
                                  {completed}/{milestones.length}
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-[var(--color-muted-foreground)]">
                            {s.deal?.amount_cents
                              ? formatCurrency(
                                  s.deal.amount_cents,
                                  s.deal.currency ?? "EUR"
                                )
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-xs text-[var(--color-muted-foreground)]">
                            {formatDateTime(s.enrolled_at)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <StudentDetailDrawer studentId={activeId} onClose={() => setActiveId(null)} />
    </div>
  )
}

function useDebounced<T>(value: T, delay: number): T {
  const [v, setV] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}
