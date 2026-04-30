-- 0007 — Replace the partial unique index with a regular one.
-- ON CONFLICT (email) won't match a partial index unless the predicate is
-- repeated, which the supabase-js client can't express. A regular unique
-- index on a nullable column already allows multiple NULLs in Postgres
-- (NULLS DISTINCT, the default) — same effective behavior we wanted.

drop index if exists leads_email_unique_idx;
create unique index leads_email_unique_idx on leads(email);
