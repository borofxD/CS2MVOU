-- Player registration, stat snapshots, MV Rating and balanced team generations.
-- The tournament currently has an intentionally open admin panel; management
-- policies below follow that model. Replace anon management with Auth before
-- using the project outside the trusted company tournament.

create extension if not exists pgcrypto;

create table if not exists private.admin_access_keys (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  label text not null default 'Tournament organizer',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
revoke all on table private.admin_access_keys from public, anon, authenticated;

create or replace function private.assert_admin_token(p_token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from private.admin_access_keys
    where token_hash = p_token_hash and enabled
  ) then
    raise exception 'Неверный ключ организатора';
  end if;
end;
$$;
revoke all on function private.assert_admin_token(text) from public, anon, authenticated;

create table if not exists private.collector_access_keys (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  label text not null default 'Stats collector',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
revoke all on table private.collector_access_keys from public, anon, authenticated;

create or replace function private.assert_collector_token(p_token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from private.collector_access_keys
    where token_hash = p_token_hash and enabled
  ) then
    raise exception 'Неверный ключ сборщика';
  end if;
end;
$$;
revoke all on function private.assert_collector_token(text) from public, anon, authenticated;

create table if not exists public.registration_settings (
  tournament_id text primary key references public.tournaments(id) on delete cascade,
  opens_at timestamptz not null default now(),
  closes_at timestamptz not null default (now() + interval '30 days'),
  enabled boolean not null default true,
  ratings_published boolean not null default false,
  team_count smallint not null default 5 check (team_count between 2 and 12),
  team_size smallint not null default 5 check (team_size between 2 and 10),
  rating_model_version text not null default 'mv-1.0',
  updated_at timestamptz not null default now(),
  check (closes_at > opens_at)
);

create table if not exists public.player_registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id text not null references public.tournaments(id) on delete cascade,
  edit_token_hash text not null check (edit_token_hash ~ '^[0-9a-f]{64}$'),
  steam_id text not null check (steam_id ~ '^7656119[0-9]{10}$'),
  cs_nick text not null check (char_length(cs_nick) between 1 and 40),
  teams_nick text not null check (char_length(teams_nick) between 1 and 80),
  country_code text not null check (country_code ~ '^[A-Z]{2,8}$'),
  faceit_level smallint check (faceit_level between 1 and 10),
  faceit_elo integer check (faceit_elo between 100 and 5000),
  premier_rating integer check (premier_rating between 0 and 50000),
  faceit_url text check (faceit_url is null or (char_length(faceit_url) <= 300 and faceit_url ~ '^https://(www\.)?faceit\.com/')),
  csstats_url text not null,
  csrep_url text not null,
  primary_role text not null default 'flex' check (primary_role in ('flex','igl','awp','entry','support','lurker')),
  secondary_role text check (secondary_role is null or secondary_role in ('igl','awp','entry','support','lurker')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  scrape_status text not null default 'queued' check (scrape_status in ('queued','processing','ready','partial','failed')),
  scrape_error text,
  last_scraped_at timestamptz,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, steam_id)
);

create table if not exists public.player_stat_snapshots (
  id bigint generated always as identity primary key,
  registration_id uuid not null references public.player_registrations(id) on delete cascade,
  source text not null check (source in ('csstats','csrep')),
  source_url text not null,
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  fetch_status text not null check (fetch_status in ('ready','failed')),
  error text,
  fetched_at timestamptz not null default now(),
  unique (registration_id, source)
);

create table if not exists public.player_ratings (
  registration_id uuid primary key references public.player_registrations(id) on delete cascade,
  model_version text not null default 'mv-1.0',
  mv_rating numeric(5,2) not null check (mv_rating between 0 and 100),
  baseline_score numeric(5,2) not null check (baseline_score between 0 and 100),
  performance_score numeric(5,2) not null check (performance_score between 0 and 100),
  confidence numeric(5,2) not null check (confidence between 0 and 100),
  explanation jsonb not null default '{}'::jsonb check (jsonb_typeof(explanation) = 'object'),
  calculated_at timestamptz not null default now(),
  frozen_at timestamptz
);

create table if not exists public.team_generations (
  id uuid primary key default gen_random_uuid(),
  tournament_id text not null references public.tournaments(id) on delete cascade,
  algorithm_version text not null,
  objective_score numeric not null default 0,
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.team_assignments (
  generation_id uuid not null references public.team_generations(id) on delete cascade,
  registration_id uuid not null references public.player_registrations(id) on delete cascade,
  team_no smallint not null check (team_no between 1 and 12),
  slot_no smallint not null check (slot_no between 1 and 10),
  primary key (generation_id, registration_id),
  unique (generation_id, team_no, slot_no)
);

create index if not exists player_registrations_status_idx on public.player_registrations (tournament_id, status);
create index if not exists player_registrations_scrape_idx on public.player_registrations (scrape_status, last_scraped_at);
create index if not exists player_ratings_mv_idx on public.player_ratings (mv_rating desc);
create index if not exists team_generations_published_idx on public.team_generations (tournament_id, is_published, created_at desc);
create index if not exists team_assignments_team_idx on public.team_assignments (generation_id, team_no, slot_no);
create index if not exists team_assignments_registration_idx on public.team_assignments (registration_id);

insert into public.registration_settings (tournament_id, opens_at, closes_at)
values ('main', now() - interval '1 day', now() + interval '30 days')
on conflict (tournament_id) do nothing;

create or replace function private.touch_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_registration_settings on public.registration_settings;
create trigger touch_registration_settings before update on public.registration_settings
for each row execute function private.touch_updated_at();

drop trigger if exists touch_player_registration on public.player_registrations;
create trigger touch_player_registration before update on public.player_registrations
for each row execute function private.touch_updated_at();

create or replace function private.keep_one_published_generation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_published then
    update public.team_generations
    set is_published = false
    where tournament_id = new.tournament_id and id <> new.id and is_published;
  end if;
  return new;
end;
$$;

drop trigger if exists keep_one_published_generation on public.team_generations;
create trigger keep_one_published_generation after insert or update of is_published on public.team_generations
for each row execute function private.keep_one_published_generation();

create or replace function public.submit_player_registration(
  p_payload jsonb,
  p_edit_token_hash text,
  p_registration_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.registration_settings%rowtype;
  v_existing public.player_registrations%rowtype;
  v_id uuid;
  v_steam_id text := trim(p_payload->>'steam_id');
  v_tournament_id text := coalesce(nullif(trim(p_payload->>'tournament_id'), ''), 'main');
  v_faceit_level smallint := nullif(p_payload->>'faceit_level', '')::smallint;
  v_faceit_elo integer := nullif(p_payload->>'faceit_elo', '')::integer;
  v_premier integer := nullif(p_payload->>'premier_rating', '')::integer;
begin
  select * into v_settings from public.registration_settings where tournament_id = v_tournament_id;
  if not found or not v_settings.enabled or now() < v_settings.opens_at or now() >= v_settings.closes_at then
    raise exception 'Регистрация сейчас закрыта';
  end if;
  if p_edit_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Некорректный токен редактирования'; end if;
  if v_steam_id !~ '^7656119[0-9]{10}$' then raise exception 'Нужен корректный SteamID64'; end if;
  if char_length(trim(p_payload->>'cs_nick')) not between 1 and 40 then raise exception 'Проверь ник в CS2'; end if;
  if char_length(trim(p_payload->>'teams_nick')) not between 1 and 80 then raise exception 'Проверь ник в Teams'; end if;
  if coalesce(p_payload->>'country_code', '') !~ '^[A-Z]{2,8}$' then raise exception 'Выбери страну'; end if;
  if v_faceit_level is not null and v_faceit_level not between 1 and 10 then raise exception 'FACEIT level должен быть от 1 до 10'; end if;
  if v_faceit_elo is not null and v_faceit_elo not between 100 and 5000 then raise exception 'Проверь FACEIT ELO'; end if;
  if v_faceit_level = 10 and (v_faceit_elo is null or v_faceit_elo < 2000) then raise exception 'Для FACEIT 10 укажи точное ELO от 2000'; end if;
  if v_premier is not null and v_premier not between 0 and 50000 then raise exception 'Premier Rating должен быть от 0 до 50000'; end if;
  if nullif(trim(p_payload->>'faceit_url'), '') is not null and trim(p_payload->>'faceit_url') !~ '^https://(www\.)?faceit\.com/' then raise exception 'Проверь ссылку на FACEIT'; end if;
  if coalesce(nullif(p_payload->>'primary_role', ''), 'flex') not in ('flex','igl','awp','entry','support','lurker') then raise exception 'Выбери основную роль'; end if;
  if nullif(p_payload->>'secondary_role', '') is not null and p_payload->>'secondary_role' not in ('igl','awp','entry','support','lurker') then raise exception 'Выбери дополнительную роль'; end if;

  if p_registration_id is not null then
    select * into v_existing from public.player_registrations where id = p_registration_id for update;
    if not found or v_existing.edit_token_hash <> p_edit_token_hash then raise exception 'Ссылка редактирования недействительна'; end if;
    update public.player_registrations set
      steam_id = v_steam_id,
      cs_nick = trim(p_payload->>'cs_nick'),
      teams_nick = trim(p_payload->>'teams_nick'),
      country_code = p_payload->>'country_code',
      faceit_level = v_faceit_level,
      faceit_elo = v_faceit_elo,
      premier_rating = v_premier,
      faceit_url = nullif(trim(p_payload->>'faceit_url'), ''),
      csstats_url = 'https://csstats.gg/player/' || v_steam_id,
      csrep_url = 'https://csrep.gg/player/' || v_steam_id,
      primary_role = coalesce(nullif(p_payload->>'primary_role', ''), 'flex'),
      secondary_role = nullif(p_payload->>'secondary_role', ''),
      status = 'pending',
      scrape_status = 'queued',
      scrape_error = null
    where id = p_registration_id
    returning id into v_id;
    return jsonb_build_object('id', v_id, 'created', false);
  end if;

  insert into public.player_registrations (
    tournament_id, edit_token_hash, steam_id, cs_nick, teams_nick, country_code,
    faceit_level, faceit_elo, premier_rating, faceit_url, csstats_url, csrep_url,
    primary_role, secondary_role
  ) values (
    v_tournament_id, p_edit_token_hash, v_steam_id, trim(p_payload->>'cs_nick'), trim(p_payload->>'teams_nick'), p_payload->>'country_code',
    v_faceit_level, v_faceit_elo, v_premier, nullif(trim(p_payload->>'faceit_url'), ''),
    'https://csstats.gg/player/' || v_steam_id, 'https://csrep.gg/player/' || v_steam_id,
    coalesce(nullif(p_payload->>'primary_role', ''), 'flex'), nullif(p_payload->>'secondary_role', '')
  ) returning id into v_id;
  return jsonb_build_object('id', v_id, 'created', true);
exception
  when unique_violation then raise exception 'Этот Steam-профиль уже зарегистрирован';
end;
$$;

create or replace function public.get_own_registration(p_registration_id uuid, p_edit_token_hash text)
returns jsonb language sql security definer set search_path = '' stable as $$
  select to_jsonb(r) - 'edit_token_hash'
  from public.player_registrations r
  where r.id = p_registration_id and r.edit_token_hash = p_edit_token_hash;
$$;

create or replace function public.get_public_players()
returns table (
  id uuid, cs_nick text, country_code text, steam_id text, faceit_level smallint,
  faceit_elo integer, premier_rating integer, csstats_url text, csrep_url text,
  primary_role text, secondary_role text, submitted_at timestamptz,
  mv_rating numeric, baseline_score numeric, performance_score numeric, confidence numeric
)
language sql security definer set search_path = '' stable as $$
  select r.id, r.cs_nick, r.country_code, r.steam_id, r.faceit_level, r.faceit_elo,
    r.premier_rating, r.csstats_url, r.csrep_url, r.primary_role, r.secondary_role,
    r.submitted_at,
    case when s.ratings_published then pr.mv_rating else null end,
    case when s.ratings_published then pr.baseline_score else null end,
    case when s.ratings_published then pr.performance_score else null end,
    case when s.ratings_published then pr.confidence else null end
  from public.player_registrations r
  join public.registration_settings s on s.tournament_id = r.tournament_id
  left join public.player_ratings pr on pr.registration_id = r.id
  where r.status = 'approved'
  order by pr.mv_rating desc nulls last, r.submitted_at;
$$;

create or replace function public.get_published_teams()
returns table (
  generation_id uuid, team_no smallint, slot_no smallint, registration_id uuid,
  cs_nick text, primary_role text, mv_rating numeric, team_average numeric
)
language sql security definer set search_path = '' stable as $$
  with active as (
    select g.id from public.team_generations g
    where g.tournament_id = 'main' and g.is_published
    order by g.created_at desc limit 1
  )
  select a.generation_id, a.team_no, a.slot_no, r.id, r.cs_nick, r.primary_role,
    pr.mv_rating, avg(pr.mv_rating) over (partition by a.team_no)
  from public.team_assignments a
  join active x on x.id = a.generation_id
  join public.player_registrations r on r.id = a.registration_id
  join public.player_ratings pr on pr.registration_id = r.id
  order by a.team_no, a.slot_no;
$$;

create or replace function public.admin_get_registration_overview(p_admin_token_hash text)
returns table (
  id uuid, cs_nick text, teams_nick text, country_code text, steam_id text,
  faceit_level smallint, faceit_elo integer, premier_rating integer, faceit_url text,
  csstats_url text, csrep_url text, primary_role text, secondary_role text,
  status text, scrape_status text, scrape_error text, last_scraped_at timestamptz,
  submitted_at timestamptz, updated_at timestamptz, mv_rating numeric,
  baseline_score numeric, performance_score numeric, confidence numeric
)
language plpgsql security definer set search_path = '' stable as $$
begin
  perform private.assert_admin_token(p_admin_token_hash);
  return query
  select r.id, r.cs_nick, r.teams_nick, r.country_code, r.steam_id, r.faceit_level,
    r.faceit_elo, r.premier_rating, r.faceit_url, r.csstats_url, r.csrep_url,
    r.primary_role, r.secondary_role, r.status, r.scrape_status, r.scrape_error,
    r.last_scraped_at, r.submitted_at, r.updated_at,
    pr.mv_rating, pr.baseline_score, pr.performance_score, pr.confidence
  from public.player_registrations r
  left join public.player_ratings pr on pr.registration_id = r.id
  order by r.submitted_at;
end;
$$;

create or replace function public.admin_update_registration_settings(p_admin_token_hash text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.registration_settings%rowtype;
begin
  perform private.assert_admin_token(p_admin_token_hash);
  update public.registration_settings set
    opens_at = (p_payload->>'opens_at')::timestamptz,
    closes_at = (p_payload->>'closes_at')::timestamptz,
    team_count = (p_payload->>'team_count')::smallint,
    team_size = (p_payload->>'team_size')::smallint,
    enabled = (p_payload->>'enabled')::boolean,
    ratings_published = (p_payload->>'ratings_published')::boolean
  where tournament_id = 'main' returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.admin_update_registration_status(p_admin_token_hash text, p_registration_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin_token(p_admin_token_hash);
  if p_status not in ('pending','approved','rejected') then raise exception 'Некорректный статус'; end if;
  update public.player_registrations set status = p_status where id = p_registration_id and tournament_id = 'main';
  if not found then raise exception 'Заявка не найдена'; end if;
end;
$$;

create or replace function public.admin_publish_balanced_teams(p_admin_token_hash text, p_objective_score numeric, p_assignments jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_generation uuid := gen_random_uuid();
begin
  perform private.assert_admin_token(p_admin_token_hash);
  if jsonb_typeof(p_assignments) <> 'array' or jsonb_array_length(p_assignments) < 4 then raise exception 'Недостаточно игроков'; end if;
  insert into public.team_generations (id, tournament_id, algorithm_version, objective_score, is_published)
  values (v_generation, 'main', 'mv-balance-1', greatest(p_objective_score, 0), true);
  insert into public.team_assignments (generation_id, registration_id, team_no, slot_no)
  select v_generation, x.registration_id, x.team_no, x.slot_no
  from jsonb_to_recordset(p_assignments) as x(registration_id uuid, team_no smallint, slot_no smallint)
  join public.player_registrations r on r.id = x.registration_id and r.tournament_id = 'main' and r.status = 'approved'
  join public.player_ratings pr on pr.registration_id = r.id;
  if (select count(*) from public.team_assignments where generation_id = v_generation) <> jsonb_array_length(p_assignments) then
    raise exception 'В списке есть неподтверждённые игроки';
  end if;
  return v_generation;
end;
$$;

create or replace function public.collector_get_queue(p_collector_token_hash text)
returns table (
  id uuid, cs_nick text, faceit_level smallint, faceit_elo integer,
  premier_rating integer, csstats_url text, csrep_url text,
  scrape_status text, last_scraped_at timestamptz
)
language plpgsql security definer set search_path = '' stable as $$
begin
  perform private.assert_collector_token(p_collector_token_hash);
  return query
  select r.id, r.cs_nick, r.faceit_level, r.faceit_elo, r.premier_rating,
    r.csstats_url, r.csrep_url, r.scrape_status, r.last_scraped_at
  from public.player_registrations r
  where r.status in ('pending','approved')
    and (r.scrape_status = 'queued' or r.last_scraped_at is null or r.last_scraped_at < now() - interval '12 hours')
  order by r.submitted_at
  limit 10;
end;
$$;

create or replace function public.collector_set_processing(p_collector_token_hash text, p_registration_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_collector_token(p_collector_token_hash);
  update public.player_registrations set scrape_status = 'processing', scrape_error = null
  where id = p_registration_id and status in ('pending','approved');
  if not found then raise exception 'Заявка не найдена'; end if;
end;
$$;

create or replace function public.collector_store_results(
  p_collector_token_hash text,
  p_registration_id uuid,
  p_snapshots jsonb,
  p_rating jsonb,
  p_scrape_status text,
  p_scrape_error text default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_collector_token(p_collector_token_hash);
  if p_scrape_status not in ('ready','partial','failed') then raise exception 'Некорректный статус сборщика'; end if;
  if jsonb_typeof(p_snapshots) <> 'array' or jsonb_array_length(p_snapshots) <> 2 then raise exception 'Нужны два слепка'; end if;

  insert into public.player_stat_snapshots (registration_id, source, source_url, metrics, fetch_status, error, fetched_at)
  select p_registration_id, x.source, x.source_url, x.metrics, x.fetch_status, x.error, coalesce(x.fetched_at, now())
  from jsonb_to_recordset(p_snapshots) as x(source text, source_url text, metrics jsonb, fetch_status text, error text, fetched_at timestamptz)
  where x.source in ('csstats','csrep') and x.fetch_status in ('ready','failed')
  on conflict (registration_id, source) do update set
    source_url = excluded.source_url,
    metrics = excluded.metrics,
    fetch_status = excluded.fetch_status,
    error = excluded.error,
    fetched_at = excluded.fetched_at;

  if p_rating is not null and jsonb_typeof(p_rating) = 'object' then
    insert into public.player_ratings (
      registration_id, model_version, mv_rating, baseline_score,
      performance_score, confidence, explanation, calculated_at
    ) values (
      p_registration_id, p_rating->>'model_version', (p_rating->>'mv_rating')::numeric,
      (p_rating->>'baseline_score')::numeric, (p_rating->>'performance_score')::numeric,
      (p_rating->>'confidence')::numeric, coalesce(p_rating->'explanation', '{}'::jsonb),
      coalesce((p_rating->>'calculated_at')::timestamptz, now())
    ) on conflict (registration_id) do update set
      model_version = excluded.model_version,
      mv_rating = excluded.mv_rating,
      baseline_score = excluded.baseline_score,
      performance_score = excluded.performance_score,
      confidence = excluded.confidence,
      explanation = excluded.explanation,
      calculated_at = excluded.calculated_at;
  end if;

  update public.player_registrations set
    scrape_status = p_scrape_status,
    scrape_error = left(p_scrape_error, 1000),
    last_scraped_at = now()
  where id = p_registration_id;
end;
$$;

alter table public.registration_settings enable row level security;
alter table public.player_registrations enable row level security;
alter table public.player_stat_snapshots enable row level security;
alter table public.player_ratings enable row level security;
alter table public.team_generations enable row level security;
alter table public.team_assignments enable row level security;

revoke all on public.registration_settings, public.player_registrations, public.player_stat_snapshots, public.player_ratings, public.team_generations, public.team_assignments from anon, authenticated;
grant select on public.registration_settings to anon, authenticated;

drop policy if exists "Public reads registration settings" on public.registration_settings;
create policy "Public reads registration settings" on public.registration_settings for select to anon, authenticated using (tournament_id = 'main');

revoke all on function public.submit_player_registration(jsonb, text, uuid) from public;
revoke all on function public.get_own_registration(uuid, text) from public;
revoke all on function public.get_public_players() from public;
revoke all on function public.get_published_teams() from public;
revoke execute on function public.submit_player_registration(jsonb, text, uuid) from authenticated;
revoke execute on function public.get_own_registration(uuid, text) from authenticated;
revoke execute on function public.get_public_players() from authenticated;
revoke execute on function public.get_published_teams() from authenticated;
grant execute on function public.submit_player_registration(jsonb, text, uuid) to anon;
grant execute on function public.get_own_registration(uuid, text) to anon;
grant execute on function public.get_public_players() to anon;
grant execute on function public.get_published_teams() to anon;
revoke all on function public.admin_get_registration_overview(text) from public;
revoke all on function public.admin_update_registration_settings(text, jsonb) from public;
revoke all on function public.admin_update_registration_status(text, uuid, text) from public;
revoke all on function public.admin_publish_balanced_teams(text, numeric, jsonb) from public;
revoke execute on function public.admin_get_registration_overview(text) from authenticated;
revoke execute on function public.admin_update_registration_settings(text, jsonb) from authenticated;
revoke execute on function public.admin_update_registration_status(text, uuid, text) from authenticated;
revoke execute on function public.admin_publish_balanced_teams(text, numeric, jsonb) from authenticated;
grant execute on function public.admin_get_registration_overview(text) to anon;
grant execute on function public.admin_update_registration_settings(text, jsonb) to anon;
grant execute on function public.admin_update_registration_status(text, uuid, text) to anon;
grant execute on function public.admin_publish_balanced_teams(text, numeric, jsonb) to anon;
revoke all on function public.collector_get_queue(text) from public;
revoke all on function public.collector_set_processing(text, uuid) from public;
revoke all on function public.collector_store_results(text, uuid, jsonb, jsonb, text, text) from public;
revoke execute on function public.collector_get_queue(text) from authenticated;
revoke execute on function public.collector_set_processing(text, uuid) from authenticated;
revoke execute on function public.collector_store_results(text, uuid, jsonb, jsonb, text, text) from authenticated;
grant execute on function public.collector_get_queue(text) to anon;
grant execute on function public.collector_set_processing(text, uuid) to anon;
grant execute on function public.collector_store_results(text, uuid, jsonb, jsonb, text, text) to anon;

do $$
declare table_name text;
begin
  foreach table_name in array array['registration_settings','player_registrations','player_ratings','team_generations','team_assignments'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;
