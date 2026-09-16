-- Автоматическая очистка завершённых map veto.
-- Комната удаляется через 15 минут после завершения; Realtime-сигнал
-- удаляется каскадно по внешнему ключу.

create extension if not exists pg_cron with schema pg_catalog;

alter table public.veto_rooms
  add column if not exists completed_at timestamptz;

-- Активных комнат не может быть больше 200, поэтому для минутной очистки
-- небольшой последовательный просмотр дешевле отдельного индекса.
drop index if exists public.veto_rooms_completed_at_idx;

create or replace function private.mark_veto_room_completion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.state->>'phase' = 'complete' then
    new.completed_at := coalesce(old.completed_at, new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

revoke all on function private.mark_veto_room_completion()
from public, anon, authenticated;

drop trigger if exists mark_veto_room_completion on public.veto_rooms;
create trigger mark_veto_room_completion
before update of state on public.veto_rooms
for each row execute function private.mark_veto_room_completion();

-- Если завершённые комнаты существовали до этой миграции, отсчёт идёт от
-- их последнего изменения, а не начинается заново.
update public.veto_rooms
set completed_at = updated_at
where state->>'phase' = 'complete'
  and completed_at is null;

create or replace function private.cleanup_veto_rooms()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.veto_rooms
  where (completed_at is not null and completed_at <= now() - interval '15 minutes')
     or expires_at <= now();

  get diagnostics v_deleted = row_count;

  -- pg_cron не чистит историю запусков автоматически. Оставляем только
  -- семь дней, чтобы сама задача очистки не создавала новый мусор.
  delete from cron.job_run_details
  where end_time < now() - interval '7 days';

  return v_deleted;
end;
$$;

revoke all on function private.cleanup_veto_rooms()
from public, anon, authenticated;

select cron.schedule(
  'cleanup-completed-veto-rooms',
  '* * * * *',
  'select private.cleanup_veto_rooms()'
);
