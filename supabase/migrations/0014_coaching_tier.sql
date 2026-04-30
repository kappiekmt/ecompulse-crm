-- 0014 — Coaching tier on deals + students.
--
-- Matched at Stripe webhook time by parsing the price/product name. The CRM
-- routes onboarding (Discord channel creation, coach assignment, comms) off
-- this value, so it must be set whenever a deal closes.
--
-- Values:
--   fundament      — entry tier
--   groepscoaching — group coaching tier
--   one_on_one     — 1-on-1 coaching tier (highest)

create type coaching_tier as enum ('fundament', 'groepscoaching', 'one_on_one');

alter table deals
  add column if not exists coaching_tier coaching_tier;

alter table students
  add column if not exists coaching_tier coaching_tier;

create index if not exists deals_coaching_tier_idx on deals(coaching_tier);
create index if not exists students_coaching_tier_idx on students(coaching_tier);
