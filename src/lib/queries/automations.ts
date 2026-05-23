import { useQuery } from "@tanstack/react-query"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import { AUTOMATIONS, type AutomationMeta } from "@/lib/automations-meta"

export type HealthLevel = "healthy" | "smoke_tested" | "warning" | "failed" | "idle" | "disabled"

export interface AutomationStatus {
  meta: AutomationMeta
  /** Resolved health verdict. */
  health: HealthLevel
  /** Last log entry across this automation's event_types (real production fire,
   *  not a smoke test — those are tracked separately). */
  lastEvent?: {
    event_type: string
    status: string
    error: string | null
    response_status: number | null
    created_at: string
  }
  /** Last smoke-test fire (rows where request_payload.test_fire is true). Used
   *  only when no real lastEvent exists, to mark the row "Smoke-tested" — never
   *  promotes it to true "Healthy". */
  lastSmokeTest?: { event_type: string; status: string; created_at: string }
  /** Latest cron run for any of this automation's cron jobs. */
  lastCronRun?: {
    jobname: string
    schedule: string
    active: boolean
    last_run_at: string | null
    last_run_status: string | null
    return_message: string | null
  }
  enabled: boolean
  /** Suggested fix derived from the latest error (if any), via meta.hardKnownIssues. */
  suggestedFix?: string
}

interface LogRow {
  event_type: string
  status: string
  error: string | null
  response_payload: { status?: number | null } | null
  request_payload: { test_fire?: boolean } | null
  created_at: string
}

interface CronRow {
  jobname: string
  schedule: string
  active: boolean
  last_run_at: string | null
  last_run_status: string | null
  return_message: string | null
}

interface ToggleRow {
  key: string
  enabled: boolean
}

function pickFix(meta: AutomationMeta, message: string | null | undefined): string | undefined {
  if (!message) return undefined
  for (const issue of meta.hardKnownIssues ?? []) {
    if (typeof issue.match === "string" ? message.includes(issue.match) : issue.match.test(message)) {
      return issue.fix
    }
  }
  return undefined
}

/** All automation statuses in one fetch — three parallel queries (toggles,
 *  recent log, cron view) combined locally against the catalog. */
export function useAutomationStatuses(opts: { refetchIntervalMs?: number } = {}) {
  return useQuery<AutomationStatus[]>({
    queryKey: ["automation-statuses"],
    enabled: isSupabaseConfigured,
    refetchInterval: opts.refetchIntervalMs ?? 60_000,
    queryFn: async () => {
      // Pull the union of log event_types this catalog cares about (one .in() filter
      // keeps it to ~200 rows in the worst case).
      const wantedTypes = Array.from(
        new Set(AUTOMATIONS.flatMap((a) => a.logEventTypes))
      )

      const [logRes, cronRes, toggleRes] = await Promise.all([
        supabase
          .from("integrations_log")
          .select("event_type, status, error, response_payload, request_payload, created_at")
          .in("event_type", wantedTypes)
          .order("created_at", { ascending: false })
          .limit(400),
        // automation_cron_health is a view in public schema, not in the
        // generated Database types — cast through unknown.
        (supabase.from as unknown as (t: string) => { select: (cols: string) => Promise<{ data: CronRow[] | null }> })(
          "automation_cron_health"
        ).select("jobname, schedule, active, last_run_at, last_run_status, return_message"),
        supabase.from("automation_settings").select("key, enabled"),
      ])

      const logs = (logRes.data ?? []) as unknown as LogRow[]
      const crons = (cronRes.data ?? []) as CronRow[]
      const toggles = (toggleRes.data ?? []) as unknown as ToggleRow[]

      // Index latest real (non-test-fire) and latest test-fire entries per
      // event_type. Smoke-test rows carry `request_payload.test_fire = true`;
      // they never promote a row to "Healthy" — only mark it "Smoke-tested".
      const latestRealByType = new Map<string, LogRow>()
      const latestTestByType = new Map<string, LogRow>()
      for (const row of logs) {
        const isTest = row.request_payload?.test_fire === true
        const target = isTest ? latestTestByType : latestRealByType
        // logs are DESC-sorted; first seen wins
        if (!target.has(row.event_type)) target.set(row.event_type, row)
      }
      const cronByJob = new Map(crons.map((c) => [c.jobname, c]))
      const toggleByKey = new Map(toggles.map((t) => [t.key, t.enabled]))

      return AUTOMATIONS.map<AutomationStatus>((meta) => {
        // Latest REAL (non-test-fire) log entry across this automation's event_types.
        let lastEvent: AutomationStatus["lastEvent"]
        for (const t of meta.logEventTypes) {
          const r = latestRealByType.get(t)
          if (!r) continue
          if (!lastEvent || r.created_at > lastEvent.created_at) {
            lastEvent = {
              event_type: r.event_type,
              status: r.status,
              error: r.error,
              response_status: r.response_payload?.status ?? null,
              created_at: r.created_at,
            }
          }
        }
        // Latest SMOKE-TEST entry — only used to mark "Smoke-tested" if no
        // real event exists. Never marks the row as truly Healthy.
        let lastSmokeTest: AutomationStatus["lastSmokeTest"]
        for (const t of meta.logEventTypes) {
          const r = latestTestByType.get(t)
          if (!r) continue
          if (!lastSmokeTest || r.created_at > lastSmokeTest.created_at) {
            lastSmokeTest = { event_type: r.event_type, status: r.status, created_at: r.created_at }
          }
        }

        // Latest cron run across this automation's cron jobs.
        let lastCronRun: AutomationStatus["lastCronRun"]
        for (const job of meta.cronJobnames ?? []) {
          const c = cronByJob.get(job)
          if (!c) continue
          if (!lastCronRun || (c.last_run_at ?? "") > (lastCronRun.last_run_at ?? "")) {
            lastCronRun = c
          }
        }

        const enabled = meta.toggleKey ? toggleByKey.get(meta.toggleKey) !== false : true

        let health: HealthLevel
        if (!enabled) {
          health = "disabled"
        } else if (lastEvent?.status === "failed") {
          health = "failed"
        } else if (lastCronRun && lastCronRun.last_run_status && lastCronRun.last_run_status !== "succeeded") {
          health = "warning"
        } else if (lastEvent?.status === "success" || lastCronRun?.last_run_status === "succeeded") {
          health = "healthy"
        } else if (lastSmokeTest?.status === "success") {
          // A smoke test passed but no real production event has fired through
          // the actual code path. The plumbing is verified end-to-end (Slack
          // delivery / config) — but we're not claiming the production fire
          // worked, because it hasn't happened.
          health = "smoke_tested"
        } else {
          // Cron registered but nothing's fired yet, or no log events ever.
          health = lastCronRun ? "healthy" : "idle"
        }

        const fix =
          pickFix(meta, lastEvent?.error) ??
          pickFix(meta, lastCronRun?.return_message ?? null)

        return { meta, health, lastEvent, lastSmokeTest, lastCronRun, enabled, suggestedFix: fix }
      })
    },
  })
}
