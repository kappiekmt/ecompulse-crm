-- 0017 — Trigger: when a student gets a coach (insert OR update), call the
-- notify-coach-assigned edge function which posts to Slack.
--
-- Single source of truth — fires for Stripe auto-assign, manual payment
-- auto-assign, and admin reassignment from the drawer alike. Async via
-- pg_net so triggers never block the writing transaction.
--
-- The bearer is read from Supabase Vault at runtime (secret name:
-- `service_key`) — never embedded in this file or in pg_proc metadata.
-- Same secret is used by every pg_cron job; rotate by updating the
-- single Vault entry.

create or replace function public.notify_coach_assigned() returns trigger
  language plpgsql
  security definer
as $$
declare
  v_url text := 'https://ecdqlgigczmiilvztsno.supabase.co/functions/v1/notify-coach-assigned';
  v_jwt text;
begin
  select decrypted_secret into v_jwt
    from vault.decrypted_secrets
    where name = 'service_key';

  -- No coach → nothing to notify.
  if NEW.coach_id is null then
    return NEW;
  end if;

  -- On UPDATE, only fire if the coach actually changed.
  if TG_OP = 'UPDATE' and NEW.coach_id is not distinct from OLD.coach_id then
    return NEW;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_jwt
    ),
    body := jsonb_build_object('student_id', NEW.id)
  );

  return NEW;
end $$;

drop trigger if exists students_coach_assigned on students;

create trigger students_coach_assigned
  after insert or update of coach_id on students
  for each row execute function public.notify_coach_assigned();
