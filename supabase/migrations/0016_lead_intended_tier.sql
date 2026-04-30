-- 0016 — Closer-set intended tier on leads.
--
-- Free text (one of 'fundament', 'groepscoaching', '1_on_1', 'nick_1_on_1')
-- so it doesn't collide with the coaching_tier enum that the payments
-- branch owns. Used to:
--   1. Show in the lead drawer / list as the pitch target.
--   2. Pre-fill the student's program when the Stripe webhook converts a
--      paid lead into a student (lead.intended_tier wins over Stripe
--      metadata + amount-based fallback).

alter table leads
  add column if not exists intended_tier text;
