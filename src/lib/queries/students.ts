import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import { useAuth } from "@/lib/auth"
import type { Json } from "@/lib/database.types"

export type OnboardingStatus = "pending" | "in_progress" | "complete"

/**
 * Milestone shape stored inside students.onboarding_checklist (jsonb).
 * Already-existing column — no migration needed.
 */
export interface Milestone {
  id: string
  title: string
  description?: string
  target_date?: string | null
  completed_at?: string | null
}

export interface StudentRow {
  id: string
  lead_id: string
  deal_id: string
  coach_id: string | null
  program: string
  discord_user_id: string | null
  whop_membership_id: string | null
  onboarding_status: OnboardingStatus
  onboarding_checklist: Milestone[] | null
  enrolled_at: string
  updated_at: string
  lead?: { full_name: string; email: string | null; phone: string | null } | null
  deal?: {
    id: string
    amount_cents: number | null
    currency: string | null
    closed_at: string | null
  } | null
  coach?: { id: string; full_name: string } | null
}

export interface StudentListFilters {
  coachId?: string | null
  status?: OnboardingStatus | "all"
  search?: string
}

/**
 * All students. RLS auto-scopes to the requester:
 *   admin → everyone, coach → coach_id = me, others → none.
 */
export function useStudentsList(filters: StudentListFilters = {}) {
  return useQuery<StudentRow[]>({
    queryKey: ["students-list", filters],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      let q = supabase
        .from("students")
        .select(
          "id, lead_id, deal_id, coach_id, program, discord_user_id, whop_membership_id, onboarding_status, onboarding_checklist, enrolled_at, updated_at, lead:leads(full_name, email, phone), deal:deals(id, amount_cents, currency, closed_at), coach:team_members!students_coach_id_fkey(id, full_name)"
        )
        .order("enrolled_at", { ascending: false })

      if (filters.coachId) q = q.eq("coach_id", filters.coachId)
      if (filters.status && filters.status !== "all")
        q = q.eq("onboarding_status", filters.status)

      const { data, error } = await q
      if (error) throw error
      let rows = (data ?? []) as unknown as StudentRow[]
      if (filters.search) {
        const s = filters.search.toLowerCase()
        rows = rows.filter(
          (r) =>
            r.lead?.full_name?.toLowerCase().includes(s) ||
            r.lead?.email?.toLowerCase().includes(s) ||
            r.program?.toLowerCase().includes(s)
        )
      }
      return rows
    },
  })
}

export function useStudent(id: string | null | undefined) {
  return useQuery<StudentRow | null>({
    queryKey: ["student", id],
    enabled: Boolean(id) && isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("students")
        .select(
          "id, lead_id, deal_id, coach_id, program, discord_user_id, whop_membership_id, onboarding_status, onboarding_checklist, enrolled_at, updated_at, lead:leads(full_name, email, phone), deal:deals(id, amount_cents, currency, closed_at), coach:team_members!students_coach_id_fkey(id, full_name)"
        )
        .eq("id", id!)
        .maybeSingle()
      if (error) throw error
      return data as unknown as StudentRow | null
    },
  })
}

export function useStudentCounts(coachId?: string | null) {
  return useQuery({
    queryKey: ["student-counts", coachId ?? "all"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      let q = supabase.from("students").select("onboarding_status, enrolled_at, coach_id")
      if (coachId) q = q.eq("coach_id", coachId)
      const { data } = await q
      const now = Date.now()
      const week = 7 * 24 * 3600 * 1000
      return {
        total: data?.length ?? 0,
        pending: (data ?? []).filter((s) => s.onboarding_status === "pending").length,
        in_progress: (data ?? []).filter((s) => s.onboarding_status === "in_progress")
          .length,
        complete: (data ?? []).filter((s) => s.onboarding_status === "complete").length,
        unassigned: (data ?? []).filter((s) => !s.coach_id).length,
        new_this_week: (data ?? []).filter(
          (s) => now - new Date(s.enrolled_at).getTime() < week
        ).length,
      }
    },
  })
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export interface UpdateStudentInput {
  id: string
  onboarding_status?: OnboardingStatus
  coach_id?: string | null
  program?: string
  discord_user_id?: string | null
  whop_membership_id?: string | null
}

export function useUpdateStudent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateStudentInput) => {
      const { id, ...patch } = input
      const { error } = await supabase
        .from("students")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["students-list"] })
      qc.invalidateQueries({ queryKey: ["student", vars.id] })
      qc.invalidateQueries({ queryKey: ["student-counts"] })
      qc.invalidateQueries({ queryKey: ["my-students"] })
      qc.invalidateQueries({ queryKey: ["my-student-counts"] })
    },
  })
}

// ─── Milestones (jsonb on students.onboarding_checklist) ────────────────────

function normaliseChecklist(value: unknown): Milestone[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((m): m is Milestone => Boolean(m && typeof m === "object" && "id" in m))
    .map((m) => ({
      id: String(m.id),
      title: String(m.title ?? ""),
      description: m.description ?? undefined,
      target_date: m.target_date ?? null,
      completed_at: m.completed_at ?? null,
    }))
}

async function writeChecklist(studentId: string, milestones: Milestone[]) {
  const { error } = await supabase
    .from("students")
    .update({
      onboarding_checklist: milestones as unknown as Json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", studentId)
  if (error) throw error
}

export interface UpsertMilestoneInput {
  studentId: string
  milestone: Omit<Milestone, "id"> & { id?: string }
}

export function useUpsertMilestone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ studentId, milestone }: UpsertMilestoneInput) => {
      const { data: row, error: readErr } = await supabase
        .from("students")
        .select("onboarding_checklist")
        .eq("id", studentId)
        .single()
      if (readErr) throw readErr
      const existing = normaliseChecklist(row?.onboarding_checklist)
      const id = milestone.id ?? crypto.randomUUID()
      const idx = existing.findIndex((m) => m.id === id)
      const next: Milestone = {
        id,
        title: milestone.title,
        description: milestone.description,
        target_date: milestone.target_date ?? null,
        completed_at: milestone.completed_at ?? null,
      }
      if (idx === -1) existing.push(next)
      else existing[idx] = next
      await writeChecklist(studentId, existing)
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["student", vars.studentId] })
      qc.invalidateQueries({ queryKey: ["students-list"] })
    },
  })
}

export function useDeleteMilestone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      studentId,
      milestoneId,
    }: {
      studentId: string
      milestoneId: string
    }) => {
      const { data: row, error: readErr } = await supabase
        .from("students")
        .select("onboarding_checklist")
        .eq("id", studentId)
        .single()
      if (readErr) throw readErr
      const existing = normaliseChecklist(row?.onboarding_checklist).filter(
        (m) => m.id !== milestoneId
      )
      await writeChecklist(studentId, existing)
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["student", vars.studentId] })
      qc.invalidateQueries({ queryKey: ["students-list"] })
    },
  })
}

export function useToggleMilestone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      studentId,
      milestoneId,
      completed,
    }: {
      studentId: string
      milestoneId: string
      completed: boolean
    }) => {
      const { data: row, error: readErr } = await supabase
        .from("students")
        .select("onboarding_checklist")
        .eq("id", studentId)
        .single()
      if (readErr) throw readErr
      const existing = normaliseChecklist(row?.onboarding_checklist).map((m) =>
        m.id === milestoneId
          ? { ...m, completed_at: completed ? new Date().toISOString() : null }
          : m
      )
      await writeChecklist(studentId, existing)
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["student", vars.studentId] })
      qc.invalidateQueries({ queryKey: ["students-list"] })
    },
  })
}

// ─── Notes (activities table, type='note') ──────────────────────────────────

export interface StudentNoteRow {
  id: string
  body: string
  created_at: string
  actor_id: string | null
  actor?: { id: string; full_name: string } | null
}

export function useStudentNotes(studentId: string | null | undefined) {
  return useQuery<StudentNoteRow[]>({
    queryKey: ["student-notes", studentId],
    enabled: Boolean(studentId) && isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activities")
        .select(
          "id, payload, created_at, actor_id, actor:team_members!activities_actor_id_fkey(id, full_name)"
        )
        .eq("student_id", studentId!)
        .eq("type", "note")
        .order("created_at", { ascending: false })
      if (error) throw error
      type Row = {
        id: string
        payload: { body?: string } | null
        created_at: string
        actor_id: string | null
        actor: { id: string; full_name: string } | null
      }
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        id: r.id,
        body: r.payload?.body ?? "",
        created_at: r.created_at,
        actor_id: r.actor_id,
        actor: r.actor,
      }))
    },
  })
}

export function useAddStudentNote() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  return useMutation({
    mutationFn: async ({
      studentId,
      body,
    }: {
      studentId: string
      body: string
    }) => {
      const { error } = await supabase.from("activities").insert({
        student_id: studentId,
        actor_id: profile?.id ?? null,
        type: "note",
        payload: { body },
      })
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["student-notes", vars.studentId] })
    },
  })
}

// ─── Activity feed (mixed events for the student timeline) ──────────────────

export interface StudentActivityRow {
  id: string
  type: string
  payload: Record<string, unknown> | null
  created_at: string
  actor_id: string | null
  actor?: { id: string; full_name: string } | null
}

export function useStudentActivity(studentId: string | null | undefined) {
  return useQuery<StudentActivityRow[]>({
    queryKey: ["student-activity", studentId],
    enabled: Boolean(studentId) && isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activities")
        .select(
          "id, type, payload, created_at, actor_id, actor:team_members!activities_actor_id_fkey(id, full_name)"
        )
        .eq("student_id", studentId!)
        .order("created_at", { ascending: false })
        .limit(40)
      if (error) throw error
      return (data ?? []) as unknown as StudentActivityRow[]
    },
  })
}
