-- Комната живёт 15 минут после создания или последнего действия.
-- Минутная задача из veto_cleanup.sql удаляет просроченную строку и
-- связанный Realtime-сигнал каскадно.

alter table public.veto_rooms
  alter column expires_at set default (now() + interval '15 minutes');

-- Старые комнаты с семидневным сроком не должны сохранять прежнее окно.
update public.veto_rooms
set expires_at = least(expires_at, now() + interval '15 minutes')
where expires_at > now() + interval '15 minutes';

create or replace function private.refresh_veto_room_expiry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.expires_at := now() + interval '15 minutes';
  return new;
end;
$$;

revoke all on function private.refresh_veto_room_expiry()
from public, anon, authenticated;

drop trigger if exists refresh_veto_room_expiry on public.veto_rooms;
create trigger refresh_veto_room_expiry
before update of state on public.veto_rooms
for each row execute function private.refresh_veto_room_expiry();
