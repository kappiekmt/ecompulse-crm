-- 0006 — Partial unique constraint on leads.email so upserts on email work.
-- NULL emails don't conflict (a lead can have no email at all), but two non-null
-- rows with the same email are deduplicated.

create unique index if not exists leads_email_unique_idx
  on leads(email)
  where email is not null;
