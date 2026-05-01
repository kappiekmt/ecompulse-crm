-- 0017 — Trigger: when a student gets a coach (insert OR update), call the
-- notify-coach-assigned edge function which posts to Slack.
--
-- Single source of truth — fires for Stripe auto-assign, manual payment
-- auto-assign, and admin reassignment from the drawer alike. Async via
-- pg_net so triggers never block the writing transaction.
--
-- The service-role JWT below is the same long-lived token used by the
-- existing pg_cron jobs (see cron.job rows for eod-report). Rotate both
-- together if it's ever revoked.

create or replace function public.notify_coach_assigned() returns trigger
  language plpgsql
  security definer
as $$
declare
  v_url text := 'https://ecdqlgigczmiilvztsno.supabase.co/functions/v1/notify-coach-assigned';
  v_jwt text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjZHFsZ2lnY3ptaWlsdnp0c25vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzQ4Njg5MywiZXhwIjoyMDkzMDYyODkzfQ.6snqxEUWpkkq4ZMmycxmCBS6ykuzx720F-UAUuVey5Q';
begin
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
