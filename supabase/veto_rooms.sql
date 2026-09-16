-- Синхронные комнаты map veto. Клиенту выдаются разные секретные ссылки;
-- в базе хранятся только SHA-256-хэши токенов.

create table if not exists public.veto_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  team1_name text not null,
  team2_name text not null,
  team1_token_hash text not null,
  team2_token_hash text not null,
  admin_token_hash text not null,
  state jsonb not null,
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  constraint veto_rooms_code_format check (code ~ '^[A-F0-9]{8}$'),
  constraint veto_rooms_team1_name check (char_length(team1_name) between 1 and 48),
  constraint veto_rooms_team2_name check (char_length(team2_name) between 1 and 48),
  constraint veto_rooms_distinct_teams check (lower(team1_name) <> lower(team2_name)),
  constraint veto_rooms_state_object check (jsonb_typeof(state) = 'object'),
  constraint veto_rooms_state_size check (octet_length(state::text) <= 131072),
  constraint veto_rooms_revision check (revision >= 0)
);

create table if not exists public.veto_room_events (
  room_id uuid primary key references public.veto_rooms(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists veto_rooms_expires_at_idx on public.veto_rooms (expires_at);

alter table public.veto_rooms enable row level security;
alter table public.veto_room_events enable row level security;

revoke all on table public.veto_rooms from public, anon, authenticated;
revoke all on table public.veto_room_events from public, anon, authenticated;
grant select on table public.veto_room_events to anon, authenticated;

drop policy if exists "No direct browser access to veto rooms" on public.veto_rooms;
create policy "No direct browser access to veto rooms"
on public.veto_rooms for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "Public can watch veto revision signals" on public.veto_room_events;
create policy "Public can watch veto revision signals"
on public.veto_room_events for select
to anon, authenticated
using (true);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.veto_initial_state()
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 1,
    'phase', 'waiting',
    'format', null,
    'formatVotes', jsonb_build_object('team1', null, 'team2', null),
    'joined', jsonb_build_object('team1', false, 'team2', false),
    'coin', jsonb_build_object('caller', 'team1', 'choice', null, 'result', null, 'winner', null),
    'roles', jsonb_build_object('teamA', null, 'teamB', null),
    'mapPool', to_jsonb(array['ancient','anubis','cache','dust2','inferno','mirage','nuke']::text[]),
    'actions', '[]'::jsonb,
    'series', '[]'::jsonb
  );
$$;

create or replace function private.veto_plan(p_format integer)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select case p_format
    when 1 then '[
      {"type":"ban","role":"A"},{"type":"ban","role":"A"},
      {"type":"ban","role":"B"},{"type":"ban","role":"B"},{"type":"ban","role":"B"},
      {"type":"ban","role":"A"},{"type":"side","role":"B","mapNo":1}
    ]'::jsonb
    when 3 then '[
      {"type":"ban","role":"A"},{"type":"ban","role":"B"},
      {"type":"pick","role":"A","mapNo":1},{"type":"side","role":"B","mapNo":1},
      {"type":"pick","role":"B","mapNo":2},{"type":"side","role":"A","mapNo":2},
      {"type":"ban","role":"B"},{"type":"ban","role":"A"},
      {"type":"side","role":"B","mapNo":3}
    ]'::jsonb
    when 5 then '[
      {"type":"ban","role":"A"},{"type":"ban","role":"B"},
      {"type":"pick","role":"A","mapNo":1},{"type":"side","role":"B","mapNo":1},
      {"type":"pick","role":"B","mapNo":2},{"type":"side","role":"A","mapNo":2},
      {"type":"pick","role":"A","mapNo":3},{"type":"side","role":"B","mapNo":3},
      {"type":"pick","role":"B","mapNo":4},{"type":"side","role":"A","mapNo":4},
      {"type":"side","role":"B","mapNo":5}
    ]'::jsonb
    else '[]'::jsonb
  end;
$$;

revoke all on function private.veto_initial_state() from public, anon, authenticated;
revoke all on function private.veto_plan(integer) from public, anon, authenticated;

create or replace function private.create_veto_room(p_team1_name text, p_team2_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team1 text := left(trim(coalesce(p_team1_name, '')), 48);
  v_team2 text := left(trim(coalesce(p_team2_name, '')), 48);
  v_room_id uuid;
  v_code text;
  v_team1_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_team2_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_admin_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if char_length(v_team1) < 1 or char_length(v_team2) < 1 then
    raise exception 'Укажите названия обеих команд';
  end if;
  if lower(v_team1) = lower(v_team2) then
    raise exception 'Команды должны отличаться';
  end if;
  if (select count(*) from public.veto_rooms where expires_at > now()) >= 200 then
    raise exception 'Достигнут лимит активных комнат';
  end if;

  loop
    v_code := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
    exit when not exists (select 1 from public.veto_rooms where code = v_code);
  end loop;

  insert into public.veto_rooms (
    code, team1_name, team2_name,
    team1_token_hash, team2_token_hash, admin_token_hash, state
  ) values (
    v_code, v_team1, v_team2,
    encode(extensions.digest(v_team1_token, 'sha256'), 'hex'),
    encode(extensions.digest(v_team2_token, 'sha256'), 'hex'),
    encode(extensions.digest(v_admin_token, 'sha256'), 'hex'),
    private.veto_initial_state()
  ) returning id into v_room_id;

  insert into public.veto_room_events (room_id, revision) values (v_room_id, 0);

  return jsonb_build_object(
    'roomId', v_room_id,
    'code', v_code,
    'team1Token', v_team1_token,
    'team2Token', v_team2_token,
    'adminToken', v_admin_token,
    'expiresAt', now() + interval '15 minutes'
  );
end;
$$;

create or replace function private.get_veto_room(p_room_id uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.veto_rooms%rowtype;
  v_hash text;
  v_role text;
begin
  if p_token is null or char_length(p_token) <> 64 then
    raise exception 'Недействительная ссылка комнаты';
  end if;

  select * into v_room from public.veto_rooms where id = p_room_id;
  if not found or v_room.expires_at <= now() then
    raise exception 'Комната не найдена или срок ссылки истёк';
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_role := case
    when v_hash = v_room.team1_token_hash then 'team1'
    when v_hash = v_room.team2_token_hash then 'team2'
    when v_hash = v_room.admin_token_hash then 'admin'
    else null
  end;
  if v_role is null then raise exception 'Недействительная ссылка комнаты'; end if;

  return jsonb_build_object(
    'roomId', v_room.id,
    'code', v_room.code,
    'team1Name', v_room.team1_name,
    'team2Name', v_room.team2_name,
    'state', v_room.state,
    'revision', v_room.revision,
    'callerRole', v_role,
    'expiresAt', v_room.expires_at
  );
end;
$$;

create or replace function private.veto_room_action(
  p_room_id uuid,
  p_token text,
  p_expected_revision bigint,
  p_action jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.veto_rooms%rowtype;
  v_hash text;
  v_caller text;
  v_actor text;
  v_type text := p_action->>'type';
  v_state jsonb;
  v_phase text;
  v_format integer;
  v_vote integer;
  v_choice text;
  v_result text;
  v_winner text;
  v_role_choice text;
  v_plan jsonb;
  v_step jsonb;
  v_expected_actor text;
  v_map text;
  v_map_no integer;
  v_side text;
  v_remaining text;
  v_series_item jsonb;
  v_next_revision bigint;
begin
  if p_token is null or char_length(p_token) <> 64 then raise exception 'Недействительная ссылка комнаты'; end if;
  if p_action is null or jsonb_typeof(p_action) <> 'object' or octet_length(p_action::text) > 4096 then
    raise exception 'Некорректное действие';
  end if;

  select * into v_room from public.veto_rooms where id = p_room_id for update;
  if not found or v_room.expires_at <= now() then raise exception 'Комната не найдена или срок ссылки истёк'; end if;
  if v_room.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'Комната уже изменилась. Загружена свежая версия.'; end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_caller := case
    when v_hash = v_room.team1_token_hash then 'team1'
    when v_hash = v_room.team2_token_hash then 'team2'
    when v_hash = v_room.admin_token_hash then 'admin'
    else null
  end;
  if v_caller is null then raise exception 'Недействительная ссылка комнаты'; end if;

  v_actor := case when v_caller = 'admin' then p_action->>'actor' else v_caller end;
  if v_actor not in ('team1', 'team2') and v_type <> 'reset' then raise exception 'Не удалось определить команду'; end if;

  v_state := v_room.state;
  v_phase := v_state->>'phase';

  if v_type = 'reset' then
    if v_caller <> 'admin' then raise exception 'Сброс доступен только создателю комнаты'; end if;
    v_state := private.veto_initial_state();

  elsif v_type = 'join' then
    if v_phase not in ('waiting', 'format') then raise exception 'Выбор уже начался'; end if;
    v_state := jsonb_set(v_state, array['joined', v_actor], 'true'::jsonb, false);
    if coalesce((v_state#>>'{joined,team1}')::boolean, false)
       and coalesce((v_state#>>'{joined,team2}')::boolean, false) then
      v_state := jsonb_set(v_state, '{phase}', '"format"'::jsonb, false);
    end if;

  elsif v_type = 'vote_format' then
    if v_phase <> 'format' then raise exception 'Сейчас формат выбрать нельзя'; end if;
    v_vote := (p_action->>'format')::integer;
    if v_vote not in (1, 3, 5) then raise exception 'Доступны только BO1, BO3 и BO5'; end if;
    v_state := jsonb_set(v_state, array['formatVotes', v_actor], to_jsonb(v_vote), false);
    if v_state#>>'{formatVotes,team1}' = v_state#>>'{formatVotes,team2}'
       and v_state#>>'{formatVotes,team1}' is not null then
      v_state := jsonb_set(v_state, '{format}', to_jsonb(v_vote), false);
      v_state := jsonb_set(v_state, '{phase}', '"coin_call"'::jsonb, false);
    end if;

  elsif v_type = 'coin_call' then
    if v_phase <> 'coin_call' or v_actor <> 'team1' then raise exception 'Орёл или решку сейчас выбирает первая команда'; end if;
    v_choice := p_action->>'choice';
    if v_choice not in ('heads', 'tails') then raise exception 'Выберите орла или решку'; end if;
    v_result := case when get_byte(extensions.gen_random_bytes(1), 0) % 2 = 0 then 'heads' else 'tails' end;
    v_winner := case when v_choice = v_result then 'team1' else 'team2' end;
    v_state := jsonb_set(v_state, '{coin,choice}', to_jsonb(v_choice), false);
    v_state := jsonb_set(v_state, '{coin,result}', to_jsonb(v_result), false);
    v_state := jsonb_set(v_state, '{coin,winner}', to_jsonb(v_winner), false);
    v_state := jsonb_set(v_state, '{phase}', '"role_choice"'::jsonb, false);

  elsif v_type = 'choose_role' then
    if v_phase <> 'role_choice' or v_actor <> v_state#>>'{coin,winner}' then raise exception 'Роль выбирает победитель жеребьёвки'; end if;
    v_role_choice := upper(p_action->>'role');
    if v_role_choice not in ('A', 'B') then raise exception 'Выберите Team A или Team B'; end if;
    if v_role_choice = 'A' then
      v_state := jsonb_set(v_state, '{roles,teamA}', to_jsonb(v_actor), false);
      v_state := jsonb_set(v_state, '{roles,teamB}', to_jsonb(case when v_actor='team1' then 'team2' else 'team1' end), false);
    else
      v_state := jsonb_set(v_state, '{roles,teamB}', to_jsonb(v_actor), false);
      v_state := jsonb_set(v_state, '{roles,teamA}', to_jsonb(case when v_actor='team1' then 'team2' else 'team1' end), false);
    end if;
    v_state := jsonb_set(v_state, '{phase}', '"veto"'::jsonb, false);

  elsif v_type in ('ban', 'pick', 'side') then
    if v_phase <> 'veto' then raise exception 'Map veto ещё не начался'; end if;
    v_format := (v_state->>'format')::integer;
    v_plan := private.veto_plan(v_format);
    v_step := v_plan->jsonb_array_length(v_state->'actions');
    if v_step is null then raise exception 'Map veto уже завершён'; end if;
    if v_type <> v_step->>'type' then raise exception 'Сейчас требуется другое действие'; end if;

    v_expected_actor := case v_step->>'role'
      when 'A' then v_state#>>'{roles,teamA}'
      when 'B' then v_state#>>'{roles,teamB}'
    end;
    if v_actor <> v_expected_actor then raise exception 'Сейчас ход другой команды'; end if;

    if v_type in ('ban', 'pick') then
      v_map := lower(p_action->>'map');
      if not (v_state->'mapPool' ? v_map) then raise exception 'Карты нет в активном пуле'; end if;
      if exists (select 1 from jsonb_array_elements(v_state->'actions') a where a->>'map' = v_map) then
        raise exception 'Эта карта уже выбрана';
      end if;
      v_state := jsonb_set(
        v_state,
        '{actions}',
        (v_state->'actions') || jsonb_build_array(jsonb_build_object('type',v_type,'map',v_map,'by',v_actor)),
        false
      );
      if v_type = 'pick' then
        v_series_item := jsonb_build_object(
          'map', v_map,
          'pickedBy', v_actor,
          'startingSide', null,
          'sideChosenBy', null
        );
        v_state := jsonb_set(v_state, '{series}', (v_state->'series') || jsonb_build_array(v_series_item), false);
      end if;
    else
      v_map_no := (v_step->>'mapNo')::integer;
      v_side := upper(p_action->>'side');
      if v_side not in ('CT', 'T') then raise exception 'Выберите CT или T'; end if;

      if jsonb_array_length(v_state->'series') < v_map_no then
        select pool.map into v_remaining
        from jsonb_array_elements_text(v_state->'mapPool') as pool(map)
        where not exists (
          select 1 from jsonb_array_elements(v_state->'actions') a where a->>'map' = pool.map
        )
        limit 1;
        if v_remaining is null then raise exception 'Не удалось определить решающую карту'; end if;
        v_series_item := jsonb_build_object(
          'map', v_remaining,
          'pickedBy', null,
          'startingSide', null,
          'sideChosenBy', null
        );
        v_state := jsonb_set(v_state, '{series}', (v_state->'series') || jsonb_build_array(v_series_item), false);
      end if;

      v_state := jsonb_set(v_state, array['series',(v_map_no-1)::text,'startingSide'], to_jsonb(v_side), false);
      v_state := jsonb_set(v_state, array['series',(v_map_no-1)::text,'sideChosenBy'], to_jsonb(v_actor), false);
      v_state := jsonb_set(
        v_state,
        '{actions}',
        (v_state->'actions') || jsonb_build_array(jsonb_build_object('type','side','side',v_side,'mapNo',v_map_no,'by',v_actor)),
        false
      );
    end if;

    if jsonb_array_length(v_state->'actions') >= jsonb_array_length(v_plan) then
      v_state := jsonb_set(v_state, '{phase}', '"complete"'::jsonb, false);
    end if;
  else
    raise exception 'Неизвестное действие';
  end if;

  v_next_revision := v_room.revision + 1;
  update public.veto_rooms
  set state = v_state, revision = v_next_revision, updated_at = now()
  where id = p_room_id;

  update public.veto_room_events
  set revision = v_next_revision, updated_at = now()
  where room_id = p_room_id;

  return private.get_veto_room(p_room_id, p_token);
end;
$$;

revoke all on function private.create_veto_room(text, text) from public, anon, authenticated;
revoke all on function private.get_veto_room(uuid, text) from public, anon, authenticated;
revoke all on function private.veto_room_action(uuid, text, bigint, jsonb) from public, anon, authenticated;

-- В exposed-схеме остаются только invoker-обёртки. Привилегированный код живёт
-- в private, которая не опубликована через Data API.
create or replace function public.create_veto_room(p_team1_name text, p_team2_name text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.create_veto_room(p_team1_name, p_team2_name) $$;

create or replace function public.get_veto_room(p_room_id uuid, p_token text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.get_veto_room(p_room_id, p_token) $$;

create or replace function public.veto_room_action(
  p_room_id uuid,
  p_token text,
  p_expected_revision bigint,
  p_action jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.veto_room_action(p_room_id, p_token, p_expected_revision, p_action) $$;

grant usage on schema private to anon, authenticated;
grant execute on function private.create_veto_room(text, text) to anon, authenticated;
grant execute on function private.get_veto_room(uuid, text) to anon, authenticated;
grant execute on function private.veto_room_action(uuid, text, bigint, jsonb) to anon, authenticated;

revoke all on function public.create_veto_room(text, text) from public, anon, authenticated;
revoke all on function public.get_veto_room(uuid, text) from public, anon, authenticated;
revoke all on function public.veto_room_action(uuid, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.create_veto_room(text, text) to anon, authenticated;
grant execute on function public.get_veto_room(uuid, text) to anon, authenticated;
grant execute on function public.veto_room_action(uuid, text, bigint, jsonb) to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'veto_room_events'
  ) then
    alter publication supabase_realtime add table public.veto_room_events;
  end if;
end $$;
