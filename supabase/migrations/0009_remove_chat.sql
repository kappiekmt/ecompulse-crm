-- 0009 — Remove DM Chat / IG Chat. Functionality cut from scope.
-- Tables are empty in production; safe to drop.

-- Drop from realtime publication first (silent if missing).
do $$
begin
  alter publication supabase_realtime drop table conversations;
exception when undefined_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime drop table messages;
exception when undefined_object then null;
end $$;

-- Drop the trigger function helper (only used by messages).
drop function if exists bump_conversation_last_message() cascade;

-- Drop tables in dependency order.
drop table if exists messages cascade;
drop table if exists conversation_participants cascade;
drop table if exists conversations cascade;

-- Drop enums no longer referenced.
drop type if exists conversation_kind;
drop type if exists conversation_status;
drop type if exists message_direction;
