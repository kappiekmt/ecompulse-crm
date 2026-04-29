# Supabase setup

## First-time provisioning

1. Create a new project at https://supabase.com/dashboard
2. From **Settings → API**, copy the Project URL and `anon` public key into `.env.local`:

   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbG...
   ```

3. Open **SQL Editor → New query**, paste the contents of `migrations/0001_init.sql`, and run it.
4. Create your first admin user:
   - **Authentication → Add user** → email + password
   - Then in the SQL editor:
     ```sql
     insert into team_members (user_id, full_name, email, role)
     values ('<auth-user-id>', 'Your Name', 'you@example.com', 'admin');
     ```

## Adding more migrations

Number them sequentially: `0002_…sql`, `0003_…sql`. Each migration is idempotent-friendly (uses `if not exists` where it makes sense) and runnable in the SQL editor.

When we adopt the Supabase CLI later, this folder is already structured for `supabase db push`.
