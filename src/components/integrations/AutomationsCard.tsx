import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { ToggleRight, Loader2, PlayCircle, CheckCircle2, XCircle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"

interface AutomationRow {
  key: string
  display_name: string
  description: string | null
  enabled: boolean
}

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

// Each user-visible toggle maps to one harness test id. Toggles without an
// entry here just don't get a per-row "Test" button.
const TOGGLE_TO_TEST_ID: Record<string, string> = {
  new_call_booked: "call_booked",
  call_cancelled: "call_cancelled",
  payment_received: "deal_closed",
  daily_eod_reports: "eod",
  weekly_report: "eow",
  pre_call_15m_reminder: "pre_call",
  onboarding_chain: "onboarding",
  recovery_enabled: "recovery",
  commission_tracking_enabled: "commission",
}

export function AutomationsCard() {
  const qc = useQueryClient()

  const [testing, setTesting] = React.useState(false)
  const [report, setReport] = React.useState<TestReport | null>(null)
  const [testError, setTestError] = React.useState<string | null>(null)
  // Per-row state for the inline "Test" button next to each toggle.
  const [rowTesting, setRowTesting] = React.useState<string | null>(null)
  const [rowResults, setRowResults] = React.useState<Record<string, TestResult>>({})

  async function callHarness(tests?: string[]) {
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

  async function runAllTests() {
    setTesting(true)
    setReport(null)
    setTestError(null)
    try {
      setReport(await callHarness())
    } catch (err) {
      setTestError((err as Error).message)
    } finally {
      setTesting(false)
    }
  }

  async function runOneTest(toggleKey: string) {
    const testId = TOGGLE_TO_TEST_ID[toggleKey]
    if (!testId) return
    setRowTesting(toggleKey)
    try {
      const json = await callHarness([testId])
      const result =
        json.results?.[0] ??
        ({ id: testId, label: testId, ok: false, error: "No result returned" } as TestResult)
      setRowResults((prev) => ({ ...prev, [toggleKey]: result }))
    } catch (err) {
      setRowResults((prev) => ({
        ...prev,
        [toggleKey]: { id: testId, label: testId, ok: false, error: (err as Error).message },
      }))
    } finally {
      setRowTesting(null)
    }
  }

  const { data: automations, isLoading } = useQuery<AutomationRow[]>({
    queryKey: ["automation-settings"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_settings")
        .select("key, display_name, description, enabled")
        .order("key")
      if (error) throw error
      return (data ?? []) as AutomationRow[]
    },
  })

  const toggle = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("automation_settings")
        .update({ enabled })
        .eq("key", key)
      if (error) throw error
    },
    onMutate: async ({ key, enabled }) => {
      await qc.cancelQueries({ queryKey: ["automation-settings"] })
      const prev = qc.getQueryData<AutomationRow[]>(["automation-settings"])
      qc.setQueryData<AutomationRow[]>(["automation-settings"], (old) =>
        old?.map((row) => (row.key === key ? { ...row, enabled } : row)) ?? []
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["automation-settings"], ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["automation-settings"] })
    },
  })

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-secondary)] text-[var(--color-foreground)]">
              <ToggleRight className="h-4 w-4" />
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-semibold">Automations</span>
              <span className="text-xs text-[var(--color-muted-foreground)]">
                Turn individual automations on or off. Changes save instantly.
              </span>
            </div>
          </div>
          {isSupabaseConfigured && (
            <Button
              variant="outline"
              size="sm"
              onClick={runAllTests}
              disabled={testing}
              title="Fires a synthetic event at every automation and reports the result. Slack-only automations post a TEST card; ones with real side effects (onboarding, recovery, commission) are readiness-checked."
            >
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              Run all tests
            </Button>
          )}
        </div>

        {(report || testError) && (
          <div className="rounded-md border border-[var(--color-border)] p-3 text-xs">
            {testError ? (
              <p className="text-[var(--color-destructive)]">✗ {testError}</p>
            ) : report ? (
              <>
                <p className="mb-2 font-medium">
                  {report.passed}/{report.count} passed
                </p>
                <ul className="flex flex-col gap-1">
                  {report.results.map((r) => (
                    <li key={r.id} className="flex items-start gap-2">
                      {r.ok ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-success)]" />
                      ) : (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-destructive)]" />
                      )}
                      <span className="flex flex-col">
                        <span className="font-medium">{r.label}</span>
                        {(r.error || r.detail) && (
                          <span className="text-[var(--color-muted-foreground)]">
                            {r.error ?? r.detail}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        )}

        {!isSupabaseConfigured ? (
          <p className="rounded-md border border-dashed border-[var(--color-border)] py-4 text-center text-xs text-[var(--color-muted-foreground)]">
            Connect Supabase to manage automations.
          </p>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-6 text-xs text-[var(--color-muted-foreground)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border)]">
            {automations?.map((row) => {
              const testId = TOGGLE_TO_TEST_ID[row.key]
              const isRowTesting = rowTesting === row.key
              const result = rowResults[row.key]
              return (
                <li
                  key={row.key}
                  className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{row.display_name}</span>
                      {row.description && (
                        <span className="text-xs text-[var(--color-muted-foreground)]">
                          {row.description}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {testId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => runOneTest(row.key)}
                          disabled={isRowTesting || testing}
                          title="Fire a one-off test for this automation"
                        >
                          {isRowTesting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <PlayCircle className="h-3.5 w-3.5" />
                          )}
                          Test
                        </Button>
                      )}
                      <Switch
                        checked={row.enabled}
                        onCheckedChange={(enabled) =>
                          toggle.mutate({ key: row.key, enabled })
                        }
                        aria-label={`Toggle ${row.display_name}`}
                      />
                    </div>
                  </div>
                  {result && (
                    <div className="ml-0.5 flex items-start gap-1.5 text-xs">
                      {result.ok ? (
                        <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-success)]" />
                      ) : (
                        <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-destructive)]" />
                      )}
                      <span className="text-[var(--color-muted-foreground)]">
                        {result.error ?? result.detail ?? (result.ok ? "passed" : "failed")}
                      </span>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
