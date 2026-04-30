-- 0013 — Capture Calendly event metadata we surface in Slack + the lead drawer:
--   calendly_event_name (e.g. "Discovery Call") for the italic subtitle line
--   calendly_join_url (e.g. Zoom/Meet link) for the "Join call" button

alter table leads
  add column if not exists calendly_event_name text,
  add column if not exists calendly_join_url text;
