import * as React from "react"
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  PauseCircle,
  CircleDashed,
  Loader2,
  PlayCircle,
  RefreshCw,
  FlaskConical,
} from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { CATEGORY_ORDER } from "@/lib/automations-meta"
import {
  useAutomationStatuses,
  type AutomationStatus,
  type HealthLevel,
} from "@/lib/queries/automations"

interface TestResult {
  id: string
  label: string
  ok: boolean
  status?: number | null
  detail?: string
  error?: string | null
}

interface TestReport {
  ok: boolean
  count: number
  passed: number
  results: TestResult[]
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "never"
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} hr ago`
  const d = Math.floor(h / 24)
  return `${d} days ago`
}

const HEALTH_PRESENTATION: Record<
  HealthLevel,
  { icon: React.ComponentType<{ className?: string }>; label: string; badge: "success" | "warning" | "destructive" | "muted" | "secondary"; cls: string; hint?: string }
> = {
  healthy: { icon: CheckCircle2, label: "Healthy", badge: "success", cls: "text-[var(--color-success)]" },
  // "smoke_tested" = a Test fire has succeeded (Slack delivery / config wired)
  // but no real production event has flowed through yet. Distinct from
  // "Healthy" on purpose: we don't claim the production code path was
  // exercised just because a smoke test passed.
  smoke_tested: { icon: FlaskConical, label: "Smoke-tested", badge: "secondary", cls: "text-[var(--color-foreground)]", hint: "Smoke test passed — awaiting real production event" },
  warning: { icon: AlertTriangle, label: "Warning", badge: "warning", cls: "text-[var(--color-warning)]" },
  failed: { icon: XCircle, label: "Failed", badge: "destructive", cls: "text-[var(--color-destructive)]" },
  idle: { icon: CircleDashed, label: "Awaiting", badge: "muted", cls: "text-[var(--color-muted-foreground)]", hint: "Wired and ready — fires on first real event" },
  disabled: { icon: PauseCircle, label: "Disabled", badge: "muted", cls: "text-[var(--color-muted-foreground)]" },
}

export function Automations() {
  const { data: rows, isLoading, refetch, isFetching, dataUpdatedAt } = useAutomationStatuses()
  const [runningAll, setRunningAll] = React.useState(false)
  const [rowTesting, setRowTesting] = React.useState<string | null>(null)
  const [rowResults, setRowResults] = React.useState<Record<string, TestResult>>({})
  const [error, setError] = React.useState<string | null>(null)

  async function callHarness(tests?: string[]): Promise<TestReport> {
    const { data: sess } = await supabase.auth.getSession()
    const jwt = sess.session?.access_token
    if (!jwt) throw new Error("Not signed in")
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/automation-tests`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify(tests ? { tests } : {}),
      }
    )
    const json = (await res.json()) as TestReport & { error?: string }
    if (!res.ok) throw new Error(json.error ?? `Harness returned ${res.status}`)
    return json
  }

  async function runOne(testId: string, rowId: string) {
    setRowTesting(rowId)
    setError(null)
    try {
      const json = await callHarness([testId])
      const r = json.results?.[0] ?? { id: testId, label: testId, ok: false, error: "No result returned" }
      setRowResults((prev) => ({ ...prev, [rowId]: r }))
    } catch (err) {
      setRowResults((prev) => ({
        ...prev,
        [rowId]: { id: testId, label: testId, ok: false, error: (err as Error).message },
      }))
    } finally {
      setRowTesting(null)
      refetch()
    }
  }

  async function runAll() {
    setRunningAll(true)
    setError(null)
    try {
      const json = await callHarness()
      const indexed: Record<string, TestResult> = {}
      for (const r of json.results) indexed[r.id] = r
      setRowResults((prev) => ({ ...prev, ...indexed }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRunningAll(false)
      refetch()
    }
  }

  const groups = React.useMemo(() => {
    const map = new Map<string, AutomationStatus[]>()
    for (const r of rows ?? []) {
      const list = map.get(r.meta.category) ?? []
      list.push(r)
      map.set(r.meta.category, list)
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({ category: c, items: map.get(c)! }))
  }, [rows])

  const summary = React.useMemo(() => {
    const s = { total: 0, healthy: 0, smoke_tested: 0, warning: 0, failed: 0, idle: 0, disabled: 0 }
    for (const r of rows ?? []) {
      s.total++
      s[r.health]++
    }
    return s
  }, [rows])

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Automations"
        description="Live health for every automation in the CRM. Click a row to test it; failures explain what to fix."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh
            </Button>
            <Button onClick={runAll} disabled={runningAll}>
              {runningAll ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              Run all tests
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-6 p-8">
        {/* Summary KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <SummaryCard label="Total" value={summary.total} icon={Activity} tone="muted" />
          <SummaryCard label="Healthy" value={summary.healthy} icon={CheckCircle2} tone="success" />
          <SummaryCard label="Smoke-tested" value={summary.smoke_tested} icon={FlaskConical} tone="muted" />
          <SummaryCard label="Warning" value={summary.warning} icon={AlertTriangle} tone="warning" />
          <SummaryCard label="Failed" value={summary.failed} icon={XCircle} tone="destructive" />
          <SummaryCard label="Idle / off" value={summary.idle + summary.disabled} icon={CircleDashed} tone="muted" />
        </div>

        {error && (
          <Card>
            <CardContent className="p-4 text-sm text-[var(--color-destructive)]">{error}</CardContent>
          </Card>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-12 text-sm text-[var(--color-muted-foreground)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading automation status…
          </div>
        )}

        {/* Per-category tables */}
        {groups.map((group) => (
          <Card key={group.category}>
            <CardContent className="p-0">
              <div className="border-b border-[var(--color-border)] px-5 py-3">
                <h3 className="text-sm font-semibold">{group.category}</h3>
              </div>
              <ul className="divide-y divide-[var(--color-border)]">
                {group.items.map((s) => (
                  <AutomationRow
                    key={s.meta.id}
                    status={s}
                    testResult={rowResults[s.meta.id]}
                    testing={rowTesting === s.meta.id}
                    runAllInFlight={runningAll}
                    onTest={() => s.meta.testId && runOne(s.meta.testId, s.meta.id)}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}

        <p className="text-[10px] text-[var(--color-muted-foreground)]">
          Auto-refreshes every 60s. Last refresh:{" "}
          {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "—"}
        </p>
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  tone: "muted" | "success" | "warning" | "destructive"
}) {
  const toneCls = {
    muted: "text-[var(--color-muted-foreground)]",
    success: "text-[var(--color-success)]",
    warning: "text-[var(--color-warning)]",
    destructive: "text-[var(--color-destructive)]",
  }[tone]
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-2 p-4">
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">{label}</span>
          <span className="text-2xl font-semibold tabular-nums">{value}</span>
        </div>
        <Icon className={cn("h-5 w-5", toneCls)} />
      </CardContent>
    </Card>
  )
}

function AutomationRow({
  status,
  testResult,
  testing,
  runAllInFlight,
  onTest,
}: {
  status: AutomationStatus
  testResult?: TestResult
  testing: boolean
  runAllInFlight: boolean
  onTest: () => void
}) {
  const { meta, health, lastEvent, lastCronRun, enabled, suggestedFix } = status
  const pres = HEALTH_PRESENTATION[health]
  const HealthIcon = pres.icon
  const Icon = meta.icon
  const lastFireIso = lastEvent?.created_at ?? lastCronRun?.last_run_at ?? null
  const lastError = lastEvent?.status === "failed" ? lastEvent.error : null
  const skippedDetail =
    !lastError && lastEvent?.status === "success" && lastCronRun?.return_message?.includes("skipped")
      ? lastCronRun.return_message
      : null

  return (
    <li className="flex flex-col gap-2 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{meta.name}</span>
              <Badge variant={pres.badge}>{pres.label}</Badge>
              {!enabled && <Badge variant="muted">Toggle off</Badge>}
            </div>
            <span className="text-xs text-[var(--color-muted-foreground)]">{meta.description}</span>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-muted-foreground)]">
              <span>{meta.scheduleLabel}</span>
              {meta.channelHint && <span>· {meta.channelHint}</span>}
              <span>· last fire {timeAgo(lastFireIso)}</span>
            </div>
            {pres.hint && (
              <span className="text-[11px] italic text-[var(--color-muted-foreground)]">{pres.hint}</span>
            )}
          </div>
        </div>
        {meta.testId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onTest}
            disabled={testing || runAllInFlight}
            title="Fire a one-off test for this automation"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
            Test
          </Button>
        )}
      </div>

      {(lastError || skippedDetail || suggestedFix) && (
        <div className="ml-7 flex flex-col gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-secondary)]/40 px-3 py-2">
          {lastError && (
            <div className="flex items-start gap-1.5 text-xs">
              <HealthIcon className={cn("mt-0.5 h-3 w-3 shrink-0", pres.cls)} />
              <span className="font-mono text-[11px] text-[var(--color-foreground)]">{lastError}</span>
            </div>
          )}
          {skippedDetail && !lastError && (
            <div className="flex items-start gap-1.5 text-xs text-[var(--color-muted-foreground)]">
              <CircleDashed className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="font-mono text-[11px]">{skippedDetail}</span>
            </div>
          )}
          {suggestedFix && (
            <div className="flex items-start gap-1.5 text-xs">
              <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                Fix:
              </span>
              <span className="text-[12px]">{suggestedFix}</span>
            </div>
          )}
        </div>
      )}

      {testResult && (
        <div className="ml-7 flex items-start gap-1.5 text-xs">
          {testResult.ok ? (
            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-success)]" />
          ) : (
            <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-destructive)]" />
          )}
          <span className="text-[var(--color-muted-foreground)]">
            Last test: {testResult.error ?? testResult.detail ?? (testResult.ok ? "passed" : "failed")}
          </span>
        </div>
      )}
    </li>
  )
}
