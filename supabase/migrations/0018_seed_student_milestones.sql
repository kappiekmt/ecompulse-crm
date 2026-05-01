-- 0018 — Auto-seed onboarding_checklist on student insert based on the
-- student's program. Coaches don't have to type the same milestones for
-- every new student; the template lands ready to tick.
--
-- Templates only exist for Groepscoaching and 1-on-1 (incl. Nick 1-on-1).
-- Fundament is self-paced — no auto-template; coaches can still add ad-hoc
-- milestones from the drawer.
--
-- Trigger fires BEFORE INSERT and only when onboarding_checklist is null,
-- empty, or '[]'::jsonb — so an explicit checklist passed in by the caller
-- (e.g. the test fixture) wins.

create or replace function public.seed_student_milestones() returns trigger
  language plpgsql
as $$
declare
  v_template jsonb := null;
  v_enrolled timestamptz := coalesce(NEW.enrolled_at, now());
begin
  -- Skip if caller already supplied milestones.
  if NEW.onboarding_checklist is not null
     and jsonb_typeof(NEW.onboarding_checklist) = 'array'
     and jsonb_array_length(NEW.onboarding_checklist) > 0 then
    return NEW;
  end if;

  if NEW.program is null then
    return NEW;
  end if;

  -- Match by program label (set elsewhere from the tier mapping).
  if lower(NEW.program) = 'groepscoaching' then
    v_template := jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid()::text,
        'title', 'Welcome call booked',
        'target_date', (v_enrolled + interval '2 days')::date::text),
      jsonb_build_object('id', gen_random_uuid()::text,
        'title', 'Discord access granted',
        'target_date', (v_enrolled + interval '2 days')::date::text),
      jsonb_build_object('id', gen_random_uuid()::text,
        'title', 'Whop membership active',
        'target_date', (v_enrolled + interval '3 days')::date::text),
      jsonb_build_object('id', gen_random_uuid()::text,
        'title', 'Kickoff group session attended',
        'target_date', (v_enrolled + interval '7 days')::date::text),
      jsonb_build_object('id', gen_random_uuid()::text,
        'title', 'Week 2: action plan submitted',
        'target_date', (v_enrolled + interval '14 days')::date::text),
      jsonb_build_object('id', gen_random_uuid()::text,
        'title', 'Mid-program check-in (week 4)',
        'target_date', (v_enrolled + interval '28 days')::date::text),
      jsonb_build_object('id', gen_random_uuid()::text,
        'title', 'Final group session attended',
        'target_date', (v_enrolled + interval '56 days')::date::text),
      jsonb_build_object('id', gen_random_uuid()::text,
        'title', 'Outcome review completed',
        'target_date', (v_enrolled + interval '63 days')::date::text)
    );
  elsif lower(NEW.program) in ('1-1 coaching', 'nick 1-1') then
    v_template := jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid()::text,
        'title', 'Welcome call booked',
        'target_date', (v_enrolled + interval '1 day')::date::text),
      jsonb_build_object('id', gen_random_uuid()::text,
        'title', 'Discord access granted',
        'target_date', (v_enrolled + interval '2 days')::date::text),
      jsonb_build_object('id', gen_random_uuid()::text,
        'title', 'Whop membership active',
        'target_date', (v_enrolled + interval '2 days')::date::text),
      jsonb_build_object('id', gen_random_uuid()::text,
        'title', 'Kickoff: goals + KPIs set',
        'target_date', (v_enrolled + interval '7 days')::date::text),
      jsonb_build_object('id', gen_random_uuid()::text,
        'title', 'Week 2: action plan + first follow-up',
        'target_date', (v_enrolled + interval '14 days')::date::text),
      jsonb_build_object('id', gen_random_uuid()::text,
        'title', 'Week 4: mid-program review',
        'target_date', (v_enrolled + interval '28 days')::date::text),
      jsonb_build_object('id', gen_random_uuid()::text,
        'title', 'Week 8: results check-in',
        'target_date', (v_enrolled + interval '56 days')::date::text),
      jsonb_build_object('id', gen_random_uuid()::text,
        'title', 'Wrap-up call + next-steps plan',
        'target_date', (v_enrolled + interval '84 days')::date::text)
    );
  end if;

  if v_template is not null then
    NEW.onboarding_checklist := v_template;
  end if;
  return NEW;
end $$;

drop trigger if exists students_seed_milestones on students;

create trigger students_seed_milestones
  before insert on students
  for each row execute function public.seed_student_milestones();
