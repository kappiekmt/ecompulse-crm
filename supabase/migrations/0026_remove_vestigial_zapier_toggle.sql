-- 0026 — Remove the vestigial `outbound_zapier_cancel` automation toggle.
--
-- This switch was seeded in 0005 for an outbound Zapier cancel/reschedule
-- webhook that no longer exists: cancellations are now posted to Slack
-- directly from calendly-webhook (see src/lib/integrations.ts — "Posted from
-- calendly-webhook directly — no Zapier needed."). No code reads this key, so
-- the toggle in CRM → Integrations → Automations did nothing. Remove it so the
-- UI stops advertising an automation that isn't wired.

delete from automation_settings where key = 'outbound_zapier_cancel';
