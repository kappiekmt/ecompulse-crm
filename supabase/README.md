# Supabase setup

Everything the CRM needs: schema, storage, realtime, reporting views, edge functions.

## 1. Create the project

1. Dashboard → New Project, name `ecompulse-crm`, strong DB password, EU-West region.
2. From **Settings → API**, copy into root `.env.local`:

   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon-key>
   ```

   Keep the `service_role` key safe — only used server-side (edge functions, migrations).

## 2. Run migrations (in order)

Open **SQL Editor → New query**, paste each file's contents, run, then move to the next:

1. `migrations/0001_init.sql` — core tables (team, leads, deals, students, activities, integrations log) + RLS + helpers.
2. `migrations/0002_features.sql` — tags, conversations & messages, payments, imports, integration configs, SOPs, call outcomes, reminders, notifications + RLS + seed tags + seed integrations.
3. `migrations/0003_storage_realtime_views.sql` — storage buckets, Realtime publication, reporting views (lead funnel, daily metrics, closer/setter performance, KPI snapshot).

## 3. Create the first admin user

Authentication → **Add user** → email + password (this is *you*).

Then in SQL Editor:

```sql
insert into team_members (user_id, full_name, email, role, timezone)
values (
  '<the-auth-user-id>',
  'Your Name',
  'you@example.com',
  'admin',
  'Europe/Amsterdam'
);
```

You can now sign in to the CRM.

## 4. Deploy edge functions

See `functions/README.md`. Webhooks for Calendly + Stripe live there.

## 5. What's live after this

- 18 tables across the core CRM and feature areas, all with RLS so closers/setters/coaches see only what they should.
- 5 storage buckets (`avatars`, `lead-attachments`, `call-recordings`, `imports`, `sop-attachments`) with role-aware policies.
- Realtime push for leads, deals, students, conversations, messages, notifications, call outcomes, reminders.
- 5 reporting views (`lead_funnel_v`, `daily_metrics_v`, `closer_performance_v`, `setter_performance_v`, `kpi_snapshot_v`) that the dashboard queries directly.
- Calendly + Stripe webhook handlers.

## Adding more migrations

Number them sequentially: `0004_…sql`, `0005_…sql`. Run each in the SQL editor in order. When we adopt the Supabase CLI fully, this folder structure already works with `supabase db push`.
