-- 0019 — Profit-split ledger.
--
-- After commissions are paid out to closers/setters, what's left is the
-- "house" profit. This table records how that profit is divided among
-- the owners. One row per owner with their share % (must sum to 100).
--
-- Default seed: 25% Kasper, 25% Senna, 50% Nick.

create table if not exists profit_splits (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid not null references team_members(id) on delete cascade,
  share_pct numeric(5,2) not null check (share_pct >= 0 and share_pct <= 100),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_member_id)
);

-- Admin-only RLS — finance is sensitive.
alter table profit_splits enable row level security;

create policy profit_splits_admin_select on profit_splits
  for select to authenticated using (current_team_role() = 'admin');

create policy profit_splits_admin_write on profit_splits
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

-- Seed the three current owners. Idempotent — re-runs leave existing
-- rows alone.
insert into profit_splits (team_member_id, share_pct, display_order)
values
  ('67073dee-02b4-496a-b418-41b05fe93617', 25.00, 0),  -- Kasper
  ('ef91f5c2-4923-457f-86d8-b277614c705b', 25.00, 1),  -- Senna
  ('bb54af79-1f78-4aba-9516-db3906d8173a', 50.00, 2)   -- Nick
on conflict (team_member_id) do nothing;
