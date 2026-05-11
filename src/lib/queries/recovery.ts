import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import type {
  InstallmentStatus,
  RecoveryEventType,
} from "@/lib/queries/closes"

export interface RecoveryQueueRow {
  id: string
  deal_id: string
  seq: number
  amount_cents: number
  due_date: string
  status: InstallmentStatus
  failed_at: string | null
  failure_reason: string | null
  written_off_at: string | null
  grace_period_days: number
  deal: {
    id: string
    lead_id: string
    coaching_tier: string | null
    amount_cents: number
    lead: { id: string; full_name: string; email: string | null } | null
    closer: { id: string; full_name: string } | null
  } | null
  last_event: {
    event_type: RecoveryEventType
    created_at: string
  } | null
}

export interface RecoveryKpis {
  total_at_risk_cents: number
  total_failed: number
  total_recovering: number
  total_paid_recent_cents: number
  total_written_off_recent_cents: number
  recovery_rate_pct: number
  write_off_rate_pct: number
}

export function useRecoveryQueue() {
  return useQuery<RecoveryQueueRow[]>({
    queryKey: ["recovery-queue"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deal_installments")
        .select(
          "id, deal_id, seq, amount_cents, due_date, status, failed_at, " +
            "failure_reason, written_off_at, grace_period_days, " +
            "deal:deals(id, lead_id, coaching_tier, amount_cents, " +
              "lead:leads(id, full_name, email), " +
              "closer:team_members!deals_closed_by_id_fkey(id, full_name)" +
            ")"
        )
        .in("status", ["failed", "recovering", "written_off"])
        .order("failed_at", { ascending: true, nullsFirst: false })
      if (error) throw error

      const rows = (data ?? []) as unknown as RecoveryQueueRow[]
      if (rows.length === 0) return []

      const ids = rows.map((r) => r.id)
      const { data: events } = await supabase
        .from("payment_recovery_events")
        .select("installment_id, event_type, created_at")
        .in("installment_id", ids)
        .order("created_at", { ascending: false })
      const latestByInst = new Map<string, RecoveryQueueRow["last_event"]>()
      for (const e of events ?? []) {
        if (!latestByInst.has(e.installment_id)) {
          latestByInst.set(e.installment_id, {
            event_type: e.event_type as RecoveryEventType,
            created_at: e.created_at,
          })
        }
      }
      return rows.map((r) => ({ ...r, last_event: latestByInst.get(r.id) ?? null }))
    },
  })
}

export function useRecoveryKpis() {
  return useQuery<RecoveryKpis>({
    queryKey: ["recovery-kpis"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()

      const [allCurrent, recent] = await Promise.all([
        supabase
          .from("deal_installments")
          .select("amount_cents, status"),
        supabase
          .from("payment_recovery_events")
          .select("event_type, installment_id, created_at")
          .gte("created_at", since)
          .in("event_type", ["resolved", "written_off", "overdue_detected"]),
      ])

      const installments = (allCurrent.data ?? []) as {
        amount_cents: number
        status: InstallmentStatus
      }[]
      const failed = installments.filter((i) => i.status === "failed")
      const recovering = installments.filter((i) => i.status === "recovering")
      const total_at_risk_cents =
        failed.reduce((s, i) => s + i.amount_cents, 0) +
        recovering.reduce((s, i) => s + i.amount_cents, 0)

      const events = (recent.data ?? []) as {
        event_type: string
        installment_id: string
      }[]
      const detected = new Set(
        events.filter((e) => e.event_type === "overdue_detected").map((e) => e.installment_id)
      )
      const resolved = new Set(
        events.filter((e) => e.event_type === "resolved").map((e) => e.installment_id)
      )
      const writtenOff = new Set(
        events.filter((e) => e.event_type === "written_off").map((e) => e.installment_id)
      )

      const recovery_rate_pct =
        detected.size === 0
          ? 0
          : Math.round((resolved.size / detected.size) * 1000) / 10
      const write_off_rate_pct =
        detected.size === 0
          ? 0
          : Math.round((writtenOff.size / detected.size) * 1000) / 10

      return {
        total_at_risk_cents,
        total_failed: failed.length,
        total_recovering: recovering.length,
        total_paid_recent_cents: 0,
        total_written_off_recent_cents: 0,
        recovery_rate_pct,
        write_off_rate_pct,
      }
    },
  })
}

interface BulkActionInput {
  installment_ids: string[]
  action: "mark_recovering" | "write_off"
  reason?: string
}

async function bulkRecoveryAction(input: BulkActionInput) {
  if (input.action === "write_off" && !input.reason?.trim()) {
    throw new Error("Write-off requires a reason.")
  }
  const nowIso = new Date().toISOString()
  const { data: me } = await supabase
    .from("team_members")
    .select("id")
    .limit(1)
    .maybeSingle()

  if (input.action === "mark_recovering") {
    const { error } = await supabase
      .from("deal_installments")
      .update({
        status: "recovering",
        last_recovery_attempt_at: nowIso,
        failure_reason: input.reason ?? null,
      })
      .in("id", input.installment_ids)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase
      .from("deal_installments")
      .update({
        status: "written_off",
        written_off_at: nowIso,
        written_off_by: me?.id ?? null,
        failure_reason: input.reason ?? null,
      })
      .in("id", input.installment_ids)
    if (error) throw new Error(error.message)
  }

  const { data: rows } = await supabase
    .from("deal_installments")
    .select("id, deal_id, deal:deals(lead_id)")
    .in("id", input.installment_ids)
  type RowWithDeal = { id: string; deal_id: string; deal: { lead_id: string } | null }
  const eventRows = ((rows ?? []) as unknown as RowWithDeal[])
    .map((r) => ({
      installment_id: r.id,
      deal_id: r.deal_id,
      lead_id: r.deal?.lead_id ?? null,
      event_type:
        input.action === "mark_recovering" ? "marked_recovering" : "written_off",
      actor_team_member_id: me?.id ?? null,
      is_system: false,
      metadata: { bulk: true, reason: input.reason ?? null },
    }))
    .filter((r) => r.lead_id !== null)
  if (eventRows.length > 0) {
    await supabase.from("payment_recovery_events").insert(eventRows)
  }
  return { ok: true, count: input.installment_ids.length }
}

export function useBulkRecoveryAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: bulkRecoveryAction,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recovery-queue"] })
      qc.invalidateQueries({ queryKey: ["recovery-kpis"] })
      qc.invalidateQueries({ queryKey: ["lead-deal"] })
    },
  })
}
