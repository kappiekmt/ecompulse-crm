import * as React from "react"
import { Link } from "react-router-dom"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Percent,
  RotateCcw,
  TrendingDown,
  XCircle,
} from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { LeadDetailDrawer } from "@/components/leads/LeadDetailDrawer"
import { useAuth } from "@/lib/auth"
import {
  useBulkRecoveryAction,
  useRecoveryKpis,
  useRecoveryQueue,
  type RecoveryQueueRow,
} from "@/lib/queries/recovery"
import { tierByKey } from "@/lib/tiers"
import type { InstallmentStatus, RecoveryEventType } from "@/lib/queries/closes"
import { cn, formatCurrency, formatDateTime } from "@/lib/utils"

type StatusFilter = "all" | InstallmentStatus

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function daysSince(iso: string | null): number {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000))
}

const STATUS_LABEL: Record<InstallmentStatus, string> = {
  scheduled: "Scheduled",
  paid: "Paid",
  failed: "Failed",
  recovering: "Recovering",
  written_off: "Written off",
  refunded: "Refunded",
}

const EVENT_LABEL: Record<RecoveryEventType, string> = {
  overdue_detected: "Overdue detected",
  reminder_sent: "Reminder sent",
  closer_notified: "Closer notified",
  admin_escalated: "Admin escalated",
  access_paused: "Access paused",
  access_resumed: "Access resumed",
  resolved: "Resolved",
  written_off: "Written off",
  marked_recovering: "Marked recovering",
  closer_contacted_customer: "Customer contacted",
  closer_unable_to_reach: "Unable to reach",
}

export function Recovery() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === "admin"

  const queue = useRecoveryQueue()
  const kpis = useRecoveryKpis()
  const bulkAction = useBulkRecoveryAction()

  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all")
  const [closerFilter, setCloserFilter] = React.useState<string>("all")
  const [minDays, setMinDays] = React.useState<number>(0)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [activeLeadId, setActiveLeadId] = React.useState<string | null>(null)
  const [writeOffReason, setWriteOffReason] = React.useState("")
  const [showWriteOff, setShowWriteOff] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)

  // NOTE: every hook must run on every render. `profile` is null while auth
  // loads (isAdmin=false) then resolves to admin, so the permission early
  // return must come AFTER all hooks — including this memo — otherwise React
  // throws "rendered more hooks than during the previous render" and the page
  // crashes for admins.
  const rows = queue.data ?? []

  const closers = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows) {
      const c = r.deal?.closer
      if (c) map.set(c.id, c.full_name)
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [rows])

  if (!isAdmin) {
    return (
      <div className="flex flex-col">
        <PageHeader
          title="Payment recovery"
          description="At-risk installments and recovery queue — admins only."
        />
        <div className="p-8">
          <Card>
            <CardContent className="p-10 text-center text-sm text-[var(--color-muted-foreground)]">
              You don't have permission to view this page.
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const filtered = rows.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false
    if (closerFilter !== "all" && (r.deal?.closer?.id ?? "") !== closerFilter) return false
    if (minDays > 0 && daysSince(r.failed_at) < minDays) return false
    return true
  })

  const k = kpis.data

  function toggleSelect(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleSelectAll(checked: boolean) {
    if (checked) setSelected(new Set(filtered.map((r) => r.id)))
    else setSelected(new Set())
  }

  async function onBulk(action: "mark_recovering" | "write_off") {
    if (selected.size === 0) return
    setActionError(null)
    try {
      if (action === "write_off") {
        if (!writeOffReason.trim()) {
          setActionError("Write-off needs a reason.")
          return
        }
        await bulkAction.mutateAsync({
          installment_ids: [...selected],
          action: "write_off",
          reason: writeOffReason.trim(),
        })
        setWriteOffReason("")
        setShowWriteOff(false)
      } else {
        await bulkAction.mutateAsync({
          installment_ids: [...selected],
          action: "mark_recovering",
        })
      }
      setSelected(new Set())
    } catch (err) {
      setActionError((err as Error).message)
    }
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Payment recovery"
        description="Failed installments, sequence progress, and write-off actions."
        actions={
          <Link to="/finance">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4" />
              Finance
            </Button>
          </Link>
        }
      />

      <div className="flex flex-col gap-6 p-8">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <KpiCard
            icon={<AlertTriangle className="h-4 w-4 text-[var(--color-destructive)]" />}
            label="At risk"
            value={k ? formatCurrency(k.total_at_risk_cents) : "—"}
            sub={k ? `${k.total_failed} failed · ${k.total_recovering} recovering` : ""}
          />
          <KpiCard
            icon={<RotateCcw className="h-4 w-4 text-[var(--color-warning)]" />}
            label="Recovery rate (30d)"
            value={k ? `${k.recovery_rate_pct}%` : "—"}
            sub="Resolved ÷ overdue detected"
          />
          <KpiCard
            icon={<TrendingDown className="h-4 w-4 text-[var(--color-muted-foreground)]" />}
            label="Write-off rate (30d)"
            value={k ? `${k.write_off_rate_pct}%` : "—"}
            sub="Written off ÷ overdue detected"
          />
          <KpiCard
            icon={<Percent className="h-4 w-4 text-[var(--color-muted-foreground)]" />}
            label="In queue"
            value={String(rows.length)}
            sub={`${filtered.length} after filters`}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/30 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Status
            </span>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">All</option>
              <option value="failed">Failed</option>
              <option value="recovering">Recovering</option>
              <option value="written_off">Written off</option>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Closer
            </span>
            <Select
              value={closerFilter}
              onChange={(e) => setCloserFilter(e.target.value)}
            >
              <option value="all">All</option>
              {closers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Min days overdue
            </span>
            <Select
              value={String(minDays)}
              onChange={(e) => setMinDays(parseInt(e.target.value, 10) || 0)}
            >
              <option value="0">Any</option>
              <option value="3">3+</option>
              <option value="7">7+</option>
              <option value="14">14+</option>
              <option value="30">30+</option>
            </Select>
          </div>

          {selected.size > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs font-medium">
                {selected.size} selected
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onBulk("mark_recovering")}
                disabled={bulkAction.isPending}
              >
                <RotateCcw className="h-3 w-3" />
                Mark recovering
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setShowWriteOff(true)}
                disabled={bulkAction.isPending}
              >
                <XCircle className="h-3 w-3" />
                Write off
              </Button>
            </div>
          )}
        </div>

        {showWriteOff && (
          <div className="flex flex-col gap-2 rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/5 px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-destructive)]">
              Write off {selected.size} installments
            </span>
            <Textarea
              rows={2}
              placeholder="Reason (required)…"
              value={writeOffReason}
              onChange={(e) => setWriteOffReason(e.target.value)}
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowWriteOff(false)
                  setWriteOffReason("")
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onBulk("write_off")}
                disabled={!writeOffReason.trim() || bulkAction.isPending}
              >
                {bulkAction.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                Confirm
              </Button>
            </div>
          </div>
        )}

        {actionError && (
          <p className="text-xs text-[var(--color-destructive)]">{actionError}</p>
        )}

        <Card>
          <CardContent className="p-0">
            {queue.isLoading ? (
              <div className="flex items-center gap-2 p-10 text-sm text-[var(--color-muted-foreground)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading recovery queue…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-[var(--color-muted-foreground)]">
                <CheckCircle2 className="h-6 w-6 text-[var(--color-success)]" />
                {rows.length === 0
                  ? "No failed installments. All clean."
                  : "No installments match these filters."}
              </div>
            ) : (
              <table className="w-full">
                <thead className="border-b border-[var(--color-border)] bg-[var(--color-muted)]/30 text-left text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  <tr>
                    <th className="w-8 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={
                          filtered.length > 0 &&
                          filtered.every((r) => selected.has(r.id))
                        }
                        onChange={(e) => toggleSelectAll(e.target.checked)}
                      />
                    </th>
                    <th className="px-3 py-2">Lead</th>
                    <th className="px-3 py-2">Closer</th>
                    <th className="px-3 py-2">Tier</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Due</th>
                    <th className="px-3 py-2 text-right">Days overdue</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Last event</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {filtered.map((row) => (
                    <Row
                      key={row.id}
                      row={row}
                      checked={selected.has(row.id)}
                      onCheck={(c) => toggleSelect(row.id, c)}
                      onOpen={() => {
                        const leadId = row.deal?.lead_id
                        if (leadId) setActiveLeadId(leadId)
                      }}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <LeadDetailDrawer leadId={activeLeadId} onClose={() => setActiveLeadId(null)} />
    </div>
  )
}

function KpiCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
          {icon}
          {label}
        </div>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {sub && (
          <span className="text-xs text-[var(--color-muted-foreground)]">{sub}</span>
        )}
      </CardContent>
    </Card>
  )
}

function Row({
  row,
  checked,
  onCheck,
  onOpen,
}: {
  row: RecoveryQueueRow
  checked: boolean
  onCheck: (c: boolean) => void
  onOpen: () => void
}) {
  const days = daysSince(row.failed_at)
  const tier = tierByKey(row.deal?.coaching_tier ?? null)?.label ?? "—"
  return (
    <tr
      className={cn(
        "text-sm",
        row.status === "failed" && "bg-[var(--color-destructive)]/[0.04]",
        row.status === "recovering" && "bg-[var(--color-warning)]/[0.04]",
        row.status === "written_off" && "opacity-60"
      )}
    >
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
          disabled={row.status === "written_off"}
        />
      </td>
      <td className="cursor-pointer px-3 py-2 hover:underline" onClick={onOpen}>
        <div className="flex flex-col">
          <span className="font-medium">{row.deal?.lead?.full_name ?? "—"}</span>
          <span className="text-xs text-[var(--color-muted-foreground)]">
            {row.deal?.lead?.email ?? ""}
          </span>
        </div>
      </td>
      <td className="px-3 py-2 text-xs">{row.deal?.closer?.full_name ?? "—"}</td>
      <td className="px-3 py-2 text-xs">{tier}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatCurrency(row.amount_cents)}
      </td>
      <td className="px-3 py-2 text-xs">{fmtDate(row.due_date)}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        <span
          className={cn(
            "font-medium",
            days >= 14 && "text-[var(--color-destructive)]",
            days >= 7 && days < 14 && "text-[var(--color-warning)]"
          )}
        >
          {days || "—"}
        </span>
      </td>
      <td className="px-3 py-2">
        <Badge
          variant={
            row.status === "failed"
              ? "destructive"
              : row.status === "recovering"
                ? "warning"
                : "outline"
          }
          className="text-[10px]"
        >
          {STATUS_LABEL[row.status]}
        </Badge>
      </td>
      <td className="px-3 py-2 text-xs">
        {row.last_event ? (
          <span>
            <span className="font-medium">{EVENT_LABEL[row.last_event.event_type]}</span>
            <br />
            <span className="text-[var(--color-muted-foreground)]">
              {formatDateTime(row.last_event.created_at)}
            </span>
          </span>
        ) : (
          <span className="text-[var(--color-muted-foreground)]">—</span>
        )}
      </td>
    </tr>
  )
}
