-- Kelimelik Online Foundation v1
-- Supabase SQL Editor veya CLI migration ile çalıştırılabilir.
-- Anonymous Auth, profile ve multiplayer istatistik temeli.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 18),
  player_code text not null unique check (player_code ~ '^[A-Z2-9]{5}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.multiplayer_stats (
  player_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('overall','kelimelik','classic')),
  matches integer not null default 0 check (matches >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  current_streak integer not null default 0 check (current_streak >= 0),
  max_streak integer not null default 0 check (max_streak >= 0),
  solved_matches integer not null default 0 check (solved_matches >= 0),
  total_solve_guesses integer not null default 0 check (total_solve_guesses >= 0),
  total_solve_ms bigint not null default 0 check (total_solve_ms >= 0),
  updated_at timestamptz not null default now(),
  primary key (player_id, mode)
);

alter table public.profiles enable row level security;
alter table public.multiplayer_stats enable row level security;

-- Public profil bilgileri oyun içindeki rakip kartlarında görülebilir.
create policy "authenticated can read profiles"
on public.profiles for select
to authenticated
using (true);

-- Kullanıcı yalnızca kendi profil satırını doğrudan değiştirebilir.
create policy "owner can update own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- İstatistikler public profil için okunabilir; doğrudan istemci yazımı yoktur.
create policy "authenticated can read multiplayer stats"
on public.multiplayer_stats for select
to authenticated
using (true);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists multiplayer_stats_touch_updated_at on public.multiplayer_stats;
create trigger multiplayer_stats_touch_updated_at
before update on public.multiplayer_stats
for each row execute function public.touch_updated_at();

create or replace function public.make_player_code()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  i integer;
begin
  for attempt in 1..100 loop
    candidate := '';
    for i in 1..5 loop
      candidate := candidate || substr(alphabet, 1 + floor(random()*length(alphabet))::integer, 1);
    end loop;
    if not exists(select 1 from public.profiles p where p.player_code=candidate) then
      return candidate;
    end if;
  end loop;
  raise exception 'Oyuncu kodu üretilemedi';
end;
$$;

create or replace function public.ensure_profile(p_nickname text)
returns table (
  id uuid,
  nickname text,
  player_code text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_name text := btrim(regexp_replace(coalesce(p_nickname,''), '\s+', ' ', 'g'));
begin
  if uid is null then
    raise exception 'Oturum gerekli';
  end if;

  if char_length(clean_name) < 2 or char_length(clean_name) > 18 then
    raise exception 'Takma ad 2-18 karakter olmalı';
  end if;

  if clean_name !~ '^[A-Za-zÇĞİÖŞÜçğıöşü0-9 _.-]+$' then
    raise exception 'Takma ad geçersiz karakter içeriyor';
  end if;

  insert into public.profiles as p(id,nickname,player_code)
  values(uid,clean_name,public.make_player_code())
  on conflict (id) do update
    set nickname=excluded.nickname,
        updated_at=now();

  insert into public.multiplayer_stats(player_id,mode)
  values (uid,'overall'),(uid,'kelimelik'),(uid,'classic')
  on conflict (player_id,mode) do nothing;

  return query
  select p.id,p.nickname,p.player_code,p.created_at
  from public.profiles p
  where p.id=uid;
end;
$$;

create or replace function public.get_public_profile(p_player_code text)
returns table (
  nickname text,
  player_code text,
  stats jsonb
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    p.nickname,
    p.player_code,
    coalesce((
      select jsonb_object_agg(s.mode,jsonb_build_object(
        'matches',s.matches,
        'wins',s.wins,
        'losses',s.losses,
        'draws',s.draws,
        'currentStreak',s.current_streak,
        'maxStreak',s.max_streak,
        'solvedMatches',s.solved_matches,
        'totalSolveGuesses',s.total_solve_guesses,
        'totalSolveMs',s.total_solve_ms
      ))
      from public.multiplayer_stats s
      where s.player_id=p.id
    ),'{}'::jsonb) as stats
  from public.profiles p
  where p.player_code=upper(replace(p_player_code,'#',''))
  limit 1;
$$;

revoke all on function public.ensure_profile(text) from public, anon;
grant execute on function public.ensure_profile(text) to authenticated;
revoke all on function public.get_public_profile(text) from public, anon;
grant execute on function public.get_public_profile(text) to authenticated;

-- Profiller için insert işlemi yalnızca ensure_profile RPC üzerinden yapılır.
revoke insert, delete on public.profiles from anon, authenticated;
revoke insert, update, delete on public.multiplayer_stats from anon, authenticated;
grant select on public.profiles to authenticated;
grant select on public.multiplayer_stats to authenticated;
