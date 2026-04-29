-- 0004 — Public API keys for inbound REST access (landing pages, partners, Zapier).
--
-- Keys are stored hashed (sha256) — the plaintext is shown to the user once
-- at creation time only. The first 12 chars of the plaintext are also stored
-- as `prefix` for easy identification in the UI ("ek_live_a1b2c3…").

create type api_key_scope as enum (
  'lead.create',     -- create leads via the public API
  'payment.create',  -- log payments via the public API
  'read.basic'       -- read-only access to summary metrics (future)
);

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  prefix text not null unique,
  hashed_key text not null unique,
  scopes api_key_scope[] not null default array['lead.create']::api_key_scope[],
  created_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_used_ip text,
  revoked_at timestamptz,
  expires_at timestamptz
);

create index api_keys_active_idx on api_keys(prefix) where revoked_at is null;

alter table api_keys enable row level security;

-- Admin-only management.
create policy api_keys_admin on api_keys
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

-- Verifier — used by edge functions via service_role.
-- Returns the matching key id if valid + not revoked + not expired, else null.
-- Bumps last_used_at as a side effect.
create or replace function verify_api_key(plaintext text, required_scope api_key_scope)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hashed text := encode(extensions.digest(plaintext, 'sha256'), 'hex');
  matched_id uuid;
begin
  select id into matched_id
  from api_keys
  where hashed_key = hashed
    and revoked_at is null
    and (expires_at is null or expires_at > now())
    and required_scope = any(scopes)
  limit 1;

  if matched_id is not null then
    update api_keys set last_used_at = now() where id = matched_id;
  end if;

  return matched_id;
end;
$$;

revoke all on function verify_api_key(text, api_key_scope) from public;
grant execute on function verify_api_key(text, api_key_scope) to service_role;

-- Helper to list keys without exposing hashes — for the UI list.
create or replace view api_keys_safe_v as
select
  id,
  name,
  prefix,
  scopes,
  created_by,
  created_at,
  last_used_at,
  last_used_ip,
  revoked_at,
  expires_at,
  case when revoked_at is null and (expires_at is null or expires_at > now())
       then 'active'
       else 'revoked'
  end as status
from api_keys;
