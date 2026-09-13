-- CS2 MVOU: одна публично редактируемая турнирная запись.
-- Клиент использует только publishable key. Service role key на сайт не попадает.

create table if not exists public.tournaments (
  id text primary key,
  state jsonb not null,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint tournaments_main_only check (id = 'main'),
  constraint tournaments_state_object check (jsonb_typeof(state) = 'object'),
  constraint tournaments_state_size check (octet_length(state::text) <= 131072)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tournaments_state_shape'
      and conrelid = 'public.tournaments'::regclass
  ) then
    alter table public.tournaments
      add constraint tournaments_state_shape check (
        coalesce(state->>'version' = '2', false)
        and jsonb_typeof(state->'teams') = 'object'
        and jsonb_typeof(state->'regular') = 'array'
        and jsonb_array_length(state->'regular') = 10
        and jsonb_typeof(state->'semifinals') = 'array'
        and jsonb_array_length(state->'semifinals') = 2
        and jsonb_typeof(state->'thirdPlace') = 'object'
        and jsonb_typeof(state->'final') = 'object'
      );
  end if;
end $$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.bump_tournament_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.bump_tournament_revision() from public, anon, authenticated;

drop trigger if exists bump_tournament_revision on public.tournaments;
create trigger bump_tournament_revision
before update on public.tournaments
for each row execute function private.bump_tournament_revision();

alter table public.tournaments enable row level security;

revoke all on table public.tournaments from anon, authenticated;
grant select, update on table public.tournaments to anon, authenticated;

drop policy if exists "Public can read main tournament" on public.tournaments;
create policy "Public can read main tournament"
on public.tournaments for select
to anon, authenticated
using (id = 'main');

drop policy if exists "Public can update main tournament" on public.tournaments;
create policy "Public can update main tournament"
on public.tournaments for update
to anon, authenticated
using (id = 'main')
with check (
  id = 'main'
  and jsonb_typeof(state) = 'object'
  and octet_length(state::text) <= 131072
);

insert into public.tournaments (id, state, revision)
values (
  'main',
  '{
    "version": 2,
    "teams": {
      "a": {"name": "", "logoUrl": ""},
      "b": {"name": "", "logoUrl": ""},
      "c": {"name": "", "logoUrl": ""},
      "d": {"name": "", "logoUrl": ""},
      "e": {"name": "", "logoUrl": ""}
    },
    "regular": [
      {"id":1,"team1":"a","team2":"b","maps":[{"winner":"","score1":"","score2":"","lobby":""}]},
      {"id":2,"team1":"e","team2":"d","maps":[{"winner":"","score1":"","score2":"","lobby":""}]},
      {"id":3,"team1":"e","team2":"c","maps":[{"winner":"","score1":"","score2":"","lobby":""}]},
      {"id":4,"team1":"a","team2":"e","maps":[{"winner":"","score1":"","score2":"","lobby":""}]},
      {"id":5,"team1":"a","team2":"d","maps":[{"winner":"","score1":"","score2":"","lobby":""}]},
      {"id":6,"team1":"c","team2":"d","maps":[{"winner":"","score1":"","score2":"","lobby":""}]},
      {"id":7,"team1":"a","team2":"c","maps":[{"winner":"","score1":"","score2":"","lobby":""}]},
      {"id":8,"team1":"d","team2":"b","maps":[{"winner":"","score1":"","score2":"","lobby":""}]},
      {"id":9,"team1":"b","team2":"c","maps":[{"winner":"","score1":"","score2":"","lobby":""}]},
      {"id":10,"team1":"e","team2":"b","maps":[{"winner":"","score1":"","score2":"","lobby":""}]}
    ],
    "semifinals": [
      {"id":1,"team1":"","team2":"","maps":[{"winner":"","score1":"","score2":"","lobby":""},{"winner":"","score1":"","score2":"","lobby":""},{"winner":"","score1":"","score2":"","lobby":""}]},
      {"id":2,"team1":"","team2":"","maps":[{"winner":"","score1":"","score2":"","lobby":""},{"winner":"","score1":"","score2":"","lobby":""},{"winner":"","score1":"","score2":"","lobby":""}]}
    ],
    "thirdPlace": {"id":1,"team1":"","team2":"","maps":[{"winner":"","score1":"","score2":"","lobby":""},{"winner":"","score1":"","score2":"","lobby":""},{"winner":"","score1":"","score2":"","lobby":""}]},
    "final": {"id":1,"team1":"","team2":"","maps":[{"winner":"","score1":"","score2":"","lobby":""},{"winner":"","score1":"","score2":"","lobby":""},{"winner":"","score1":"","score2":"","lobby":""}]}
  }'::jsonb,
  0
)
on conflict (id) do update
set state = excluded.state,
    revision = public.tournaments.revision + 1,
    updated_at = now();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tournaments'
  ) then
    alter publication supabase_realtime add table public.tournaments;
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'team-logos',
  'team-logos',
  true,
  1048576,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can inspect team logos for upsert" on storage.objects;
create policy "Public can inspect team logos for upsert"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'team-logos');

drop policy if exists "Public can upload fixed team logos" on storage.objects;
create policy "Public can upload fixed team logos"
on storage.objects for insert
to anon, authenticated
with check (
  bucket_id = 'team-logos'
  and name ~ '^teams/[a-e]\.webp$'
);

drop policy if exists "Public can replace fixed team logos" on storage.objects;
create policy "Public can replace fixed team logos"
on storage.objects for update
to anon, authenticated
using (
  bucket_id = 'team-logos'
  and name ~ '^teams/[a-e]\.webp$'
)
with check (
  bucket_id = 'team-logos'
  and name ~ '^teams/[a-e]\.webp$'
);
