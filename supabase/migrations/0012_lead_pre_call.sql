-- 0012 — Track whether the pre-call SOP has been started for a lead.
--
-- Boolean flag + timestamp. We also keep a completed_at for future use (the
-- closer marks the SOP done before the call). For now the UI surfaces only
-- pre_call_started; when toggled true we set pre_call_started_at = now() and
-- when toggled false we clear it.

alter table leads
  add column if not exists pre_call_started boolean not null default false,
  add column if not exists pre_call_started_at timestamptz,
  add column if not exists pre_call_completed_at timestamptz;

-- Partial index — useful when filtering / counting "leads with pre-call in progress".
create index if not exists leads_pre_call_started_idx
  on leads(pre_call_started_at desc)
  where pre_call_started = true;
