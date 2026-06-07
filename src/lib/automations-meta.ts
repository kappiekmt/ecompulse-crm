// Catalog of every automation in EcomPulse. Drives:
//  - the /automations health page (table + status + suggested fix)
//  - the dashboard alert banner ("⚠ N automations need attention")
//
// To add a new automation: add an entry here. To re-categorize one: edit
// `category`. No other code change needed for the page to display it.

import {
  Calendar,
  CalendarX,
  AlarmClock,
  DollarSign,
  UserPlus,
  GraduationCap,
  Receipt,
  Siren,
  Coins,
  Moon,
  BarChart3,
  TrendingUp,
  Webhook,
  type LucideIcon,
} from "lucide-react"

export type AutomationCategory =
  | "Scheduled report"
  | "Cron job"
  | "Slack notification"
  | "Webhook receiver"
  | "DB trigger"

export interface KnownIssue {
  /** Substring or RegExp matched against the most-recent error/skipped message. */
  match: string | RegExp
  /** Plain-English instruction shown to the admin. */
  fix: string
}

export interface AutomationMeta {
  /** Stable id (also used as the automation-tests harness `tests[]` value when `testId` is set). */
  id: string
  name: string
  description: string
  category: AutomationCategory
  icon: LucideIcon
  /** Human-readable schedule / trigger ("Daily 21:00 Amsterdam", "On Calendly booking"). */
  scheduleLabel: string
  /** Matching `cron.job.jobname` rows in `automation_cron_health`. */
  cronJobnames?: string[]
  /** `integrations_log.event_type` rows to consider when computing health. */
  logEventTypes: string[]
  /** `automation_settings.key` if this automation has an admin toggle. */
  toggleKey?: string
  /** automation-tests harness id (omit if there's no test for it). */
  testId?: string
  /** Where the message lands when it fires. */
  channelHint?: string
  /** Error-pattern → suggested-fix mapping. First match wins. */
  hardKnownIssues?: KnownIssue[]
}

export const AUTOMATIONS: AutomationMeta[] = [
  {
    id: "eod",
    name: "EOD report",
    description: "Daily team end-of-day summary.",
    category: "Scheduled report",
    icon: Moon,
    scheduleLabel: "Daily 21:00 Amsterdam",
    cronJobnames: ["eod-report-amsterdam-cest", "eod-report-amsterdam-cet"],
    logEventTypes: ["eod_report"],
    toggleKey: "daily_eod_reports",
    testId: "eod",
    channelHint: "#eod",
    hardKnownIssues: [
      { match: /not 21:00/, fix: "Skipped because the cron's DST sibling fired (expected — only the in-season row sends). No action needed." },
      { match: /webhook URL not configured/, fix: "Set `eod_webhook_url` in Integrations → Slack." },
    ],
  },
  {
    id: "eow",
    name: "EOW report",
    description: "Weekly team performance summary.",
    category: "Scheduled report",
    icon: BarChart3,
    scheduleLabel: "Sundays 22:00 Amsterdam",
    cronJobnames: ["eow-report-amsterdam-cest", "eow-report-amsterdam-cet"],
    logEventTypes: ["eow_report"],
    toggleKey: "weekly_report",
    testId: "eow",
    channelHint: "#eod",
    hardKnownIssues: [
      { match: /not Sunday|not 22:00/, fix: "Skipped because today/this hour isn't the scheduled fire — expected." },
    ],
  },
  {
    id: "pre_call",
    name: "Pre-call reminder",
    description: "Slack ping to the assigned closer 15 minutes before each call.",
    category: "Cron job",
    icon: AlarmClock,
    scheduleLabel: "Every minute (fires when due)",
    cronJobnames: ["dispatch-reminders-every-minute"],
    logEventTypes: ["slack.pre_call_reminder"],
    toggleKey: "pre_call_15m_reminder",
    testId: "pre_call",
    channelHint: "→ closer's bookings channel",
  },
  {
    id: "call_booked",
    name: "Call booked",
    description: "Calendly booking → upsert lead, schedule pre-call reminder, post to Slack.",
    category: "Webhook receiver",
    icon: Calendar,
    scheduleLabel: "On every Calendly invitee.created",
    // calendly-webhook writes 3 different log lines per booking — the raw
    // Calendly inbound, the lead-created data event, and the outbound Slack.
    logEventTypes: ["slack.call_booked", "call.booked", "invitee.created"],
    toggleKey: "new_call_booked",
    testId: "call_booked",
    channelHint: "#bookings",
    hardKnownIssues: [
      { match: /Invalid signature/, fix: "Check Calendly `signing_key` in Integrations → Calendly." },
    ],
  },
  {
    id: "call_cancelled",
    name: "Call cancelled",
    description: "Calendly cancel → mark lead, post to Slack.",
    category: "Webhook receiver",
    icon: CalendarX,
    scheduleLabel: "On every Calendly invitee.canceled",
    logEventTypes: ["slack.call_cancelled", "call.cancelled", "invitee.canceled"],
    toggleKey: "call_cancelled",
    testId: "call_cancelled",
    channelHint: "#cancellations",
  },
  {
    id: "deal_closed",
    name: "Deal closed",
    description: "Closer logs a deal close in the CRM → Slack #payments alert + closer commission DM.",
    category: "Slack notification",
    icon: DollarSign,
    scheduleLabel: "On manual close (Log Close dialog)",
    // Stripe webhook is no longer used — payments are logged manually via the
    // CRM, so the only event that fires is notify-deal-closed's "deal.closed".
    logEventTypes: ["deal.closed"],
    toggleKey: "payment_received",
    testId: "deal_closed",
    channelHint: "#payments (falls back to #bookings)",
  },
  {
    id: "coach_assigned",
    name: "Coach assigned",
    description: "DB trigger when a student gets a coach → Slack alert.",
    category: "DB trigger",
    icon: UserPlus,
    scheduleLabel: "On students.coach_id change",
    // notify-coach-assigned logs "slack.coach_assigned".
    logEventTypes: ["slack.coach_assigned"],
    channelHint: "#coach_assign",
  },
  {
    id: "onboarding",
    name: "Discord invite",
    description: "Admin/coach issues a Discord welcome invite for a student from the Students page.",
    category: "Slack notification",
    icon: GraduationCap,
    scheduleLabel: "Manual — Students page",
    // discord-invite logs "discord.create_invite" each time an invite is issued.
    // Note: the old "Stripe payment → auto invite" chain is dead — Stripe isn't
    // integrated anymore, so the only path is the manual button.
    logEventTypes: ["discord.create_invite"],
    toggleKey: "onboarding_chain",
    testId: "onboarding",
    hardKnownIssues: [
      { match: /discord bot_token not set/, fix: "Connect Discord in Integrations → Discord (set bot_token + welcome_channel_id)." },
      { match: /discord welcome_channel_id not set/, fix: "Set welcome_channel_id in Integrations → Discord." },
    ],
  },
  {
    id: "installment_paid",
    name: "Installment paid",
    description: "Slack alert when a closer logs an installment as paid.",
    category: "Slack notification",
    icon: Receipt,
    scheduleLabel: "On installment marked paid",
    logEventTypes: ["installment.paid", "deal.fully_paid"],
    channelHint: "#payments (falls back to #bookings)",
  },
  {
    id: "recovery",
    name: "Payment recovery",
    description: "Daily sweep of overdue installments + Day 3 / Day 7 / Day 14 escalations.",
    category: "Cron job",
    icon: Siren,
    scheduleLabel: "Daily 09:00 + 10:00 Amsterdam",
    cronJobnames: [
      "check-overdue-payments-cest",
      "check-overdue-payments-cet",
      "payment-recovery-sequence-cest",
      "payment-recovery-sequence-cet",
    ],
    // check-overdue-payments logs "recovery.check"; payment-recovery-sequence
    // logs "recovery.sequence" + per-stage rows when it acts (reminder_stub,
    // access_paused_stub, closer_notified, admin_escalated).
    logEventTypes: [
      "recovery.check",
      "recovery.sequence",
      "recovery.reminder_stub",
      "recovery.access_paused_stub",
      "closer_notified",
      "admin_escalated",
    ],
    toggleKey: "recovery_enabled",
    testId: "recovery",
    channelHint: "#b-payment-failed",
    hardKnownIssues: [
      { match: /SLACK_BOT_TOKEN/, fix: "Add the Slack bot's `chat:write.public` scope, then invite the bot to #b-payment-failed." },
      { match: /channel_not_found/, fix: "Create #b-payment-failed in Slack, OR add `chat:write.public` to the bot." },
    ],
  },
  {
    id: "commission",
    name: "Commission earned",
    description: "DM to the closer when a payment credits commission.",
    category: "Slack notification",
    icon: Coins,
    scheduleLabel: "On every payment that credits commission",
    // notify-commission-earned logs "commission.earned.dm" on success and
    // "commission.earned.no_slack_id" when the closer has no Slack ID.
    // weekly_recap belongs to the separate "Weekly closer recap" row below —
    // including it here used to falsely show this as Healthy.
    logEventTypes: ["commission.earned.dm", "commission.earned.no_slack_id"],
    toggleKey: "commission_tracking_enabled",
    testId: "commission",
    channelHint: "Slack DM to the closer",
    hardKnownIssues: [
      { match: /no slack_user_id/, fix: "The closer is missing `slack_user_id`. Add it on the Team page." },
      { match: /SLACK_BOT_TOKEN/, fix: "Slack bot is missing `im:write` scope (or `SLACK_BOT_TOKEN` is unset)." },
    ],
  },
  {
    id: "closer_recap",
    name: "Weekly closer recap",
    description: "Mondays 09:00 — per-closer DM with last week's metrics + Claude coaching note.",
    category: "Scheduled report",
    icon: TrendingUp,
    scheduleLabel: "Mondays 09:00 Amsterdam",
    cronJobnames: ["weekly-closer-recap-cest", "weekly-closer-recap-cet"],
    logEventTypes: ["commission.weekly_recap"],
    channelHint: "Slack DM to each closer",
  },
  {
    id: "calendly_inbound",
    name: "Calendly webhook",
    description: "Inbound — Calendly posts invitee.created / invitee.canceled events here.",
    category: "Webhook receiver",
    icon: Webhook,
    scheduleLabel: "On every Calendly event",
    // calendly-webhook logs `evt.event` from Calendly's payload — i.e. raw
    // "invitee.created" / "invitee.canceled" (no provider prefix).
    logEventTypes: ["invitee.created", "invitee.canceled"],
  },
  {
    id: "deal_log_sync",
    name: "Deal log sync",
    description:
      "Inbound — the Deal & Comms tracker sheet posts each closed deal here (event:deal). Creates lead + won deal + payment, feeding the dashboard + commissions.",
    category: "Webhook receiver",
    icon: Receipt,
    scheduleLabel: "On every logged deal",
    logEventTypes: ["deal.logged"],
    hardKnownIssues: [
      {
        match: /unmatched/i,
        fix: "A closer/setter name in the sheet didn't match a CRM team member. Align the name on the Team page (a first name like \"Nick\" matches \"Nick Lastname\"), then re-run CRM Sync → Sync all rows.",
      },
    ],
  },
  // Stripe webhook removed from the dashboard — payments are logged manually
  // via the CRM (Log Close dialog), no Stripe integration is in use. The
  // stripe-webhook edge function stays deployed for the day this comes back.
]

export const CATEGORY_ORDER: AutomationCategory[] = [
  "Scheduled report",
  "Cron job",
  "Slack notification",
  "DB trigger",
  "Webhook receiver",
]
