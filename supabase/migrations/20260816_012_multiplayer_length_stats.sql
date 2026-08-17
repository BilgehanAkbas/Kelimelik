-- Kelimelik / Kelime Avcısı
-- Online istatistikleri harf sayısına göre ayırır.
-- 2026-08-16

create table if not exists public.multiplayer_stats_by_length (
  player_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('kelimelik','classic')),
  word_length smallint not null check (word_length in (4,5,6)),
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
  primary key (player_id,mode,word_length)
);

alter table public.multiplayer_stats_by_length enable row level security;

drop policy if exists "authenticated can read multiplayer length stats"
on public.multiplayer_stats_by_length;

-- Harf bazlı istatistikler doğrudan tablo erişimiyle değil, yalnızca
-- get_public_profile SECURITY DEFINER RPC'si üzerinden okunur.
revoke all on public.multiplayer_stats_by_length from public, anon, authenticated;

drop trigger if exists multiplayer_stats_by_length_touch_updated_at
on public.multiplayer_stats_by_length;

create trigger multiplayer_stats_by_length_touch_updated_at
before update on public.multiplayer_stats_by_length
for each row execute function public.touch_updated_at();


create or replace function public.apply_multiplayer_length_stat(
  p_player_id uuid,
  p_mode text,
  p_word_length integer,
  p_result_kind text,
  p_solved boolean,
  p_attempts integer,
  p_solve_ms bigint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_player_id is null
     or p_mode not in ('kelimelik','classic')
     or p_word_length not in (4,5,6)
     or p_result_kind not in ('win','loss','draw') then
    return;
  end if;

  insert into public.multiplayer_stats_by_length(player_id,mode,word_length)
  values(p_player_id,p_mode,p_word_length)
  on conflict (player_id,mode,word_length) do nothing;

  update public.multiplayer_stats_by_length s
  set matches=s.matches+1,
      wins=s.wins+case when p_result_kind='win' then 1 else 0 end,
      losses=s.losses+case when p_result_kind='loss' then 1 else 0 end,
      draws=s.draws+case when p_result_kind='draw' then 1 else 0 end,
      max_streak=case
        when p_result_kind='win'
        then greatest(s.max_streak,s.current_streak+1)
        else s.max_streak
      end,
      current_streak=case
        when p_result_kind='win' then s.current_streak+1
        else 0
      end,
      solved_matches=s.solved_matches+case when p_solved then 1 else 0 end,
      total_solve_guesses=s.total_solve_guesses+
        case when p_solved then greatest(0,coalesce(p_attempts,0)) else 0 end,
      total_solve_ms=s.total_solve_ms+
        case when p_solved then greatest(0,coalesce(p_solve_ms,0)) else 0 end,
      updated_at=clock_timestamp()
  where s.player_id=p_player_id
    and s.mode=p_mode
    and s.word_length=p_word_length;
end;
$$;

revoke all on function public.apply_multiplayer_length_stat(uuid,text,integer,text,boolean,integer,bigint)
from public, anon, authenticated;


create or replace function public.capture_live_match_length_stats()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p record;
  result_kind text;
  solved boolean;
  solve_ms bigint;
begin
  if old.stats_recorded_at is not null
     or new.stats_recorded_at is null
     or new.status<>'ended' then
    return new;
  end if;

  for p in
    select lp.player_id,lp.attempts_used,lp.solved_at
    from public.live_match_players lp
    where lp.match_id=new.id
  loop
    result_kind:=case
      when new.winner_id is null then 'draw'
      when p.player_id=new.winner_id then 'win'
      else 'loss'
    end;

    solved:=p.solved_at is not null;
    solve_ms:=case
      when solved and new.started_at is not null
      then greatest(
        0,
        floor(extract(epoch from (p.solved_at-new.started_at))*1000)::bigint
      )
      else 0
    end;

    perform public.apply_multiplayer_length_stat(
      p.player_id,
      new.mode,
      new.word_length,
      result_kind,
      solved,
      p.attempts_used,
      solve_ms
    );
  end loop;

  return new;
end;
$$;

revoke all on function public.capture_live_match_length_stats()
from public, anon, authenticated;

drop trigger if exists live_match_length_stats_capture on public.live_matches;
create trigger live_match_length_stats_capture
after update of stats_recorded_at on public.live_matches
for each row execute function public.capture_live_match_length_stats();


create or replace function public.capture_bot_match_length_stats()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result_kind text;
  solved boolean;
  solve_ms bigint;
begin
  if old.stats_recorded_at is not null
     or new.stats_recorded_at is null
     or new.status<>'ended' then
    return new;
  end if;

  result_kind:=case
    when new.winner_kind='human' then 'win'
    when new.winner_kind='bot' then 'loss'
    else 'draw'
  end;

  solved:=new.player_solved_at is not null;
  solve_ms:=case
    when solved and new.started_at is not null
    then greatest(
      0,
      floor(extract(epoch from (new.player_solved_at-new.started_at))*1000)::bigint
    )
    else 0
  end;

  perform public.apply_multiplayer_length_stat(
    new.player_id,
    new.mode,
    new.word_length,
    result_kind,
    solved,
    new.player_attempts_used,
    solve_ms
  );

  return new;
end;
$$;

revoke all on function public.capture_bot_match_length_stats()
from public, anon, authenticated;

drop trigger if exists bot_match_length_stats_capture on public.bot_matches;
create trigger bot_match_length_stats_capture
after update of stats_recorded_at on public.bot_matches
for each row execute function public.capture_bot_match_length_stats();


-- Geçmiş tamamlanmış maçlardan harf bazlı istatistikleri yeniden oluştur.
delete from public.multiplayer_stats_by_length;

do $$
declare
  r record;
begin
  for r in
    select *
    from (
      select
        lp.player_id,
        m.mode,
        m.word_length,
        case
          when m.winner_id is null then 'draw'
          when lp.player_id=m.winner_id then 'win'
          else 'loss'
        end as result_kind,
        (lp.solved_at is not null) as solved,
        lp.attempts_used as attempts_used,
        case
          when lp.solved_at is not null and m.started_at is not null
          then greatest(
            0,
            floor(extract(epoch from (lp.solved_at-m.started_at))*1000)::bigint
          )
          else 0
        end as solve_ms,
        coalesce(m.ended_at,m.stats_recorded_at,m.updated_at,m.created_at) as sort_time,
        m.id::text as sort_id
      from public.live_matches m
      join public.live_match_players lp on lp.match_id=m.id
      where m.status='ended'
        and m.stats_recorded_at is not null

      union all

      select
        m.player_id,
        m.mode,
        m.word_length,
        case
          when m.winner_kind='human' then 'win'
          when m.winner_kind='bot' then 'loss'
          else 'draw'
        end as result_kind,
        (m.player_solved_at is not null) as solved,
        m.player_attempts_used as attempts_used,
        case
          when m.player_solved_at is not null and m.started_at is not null
          then greatest(
            0,
            floor(extract(epoch from (m.player_solved_at-m.started_at))*1000)::bigint
          )
          else 0
        end as solve_ms,
        coalesce(m.ended_at,m.stats_recorded_at,m.updated_at,m.created_at) as sort_time,
        m.id::text as sort_id
      from public.bot_matches m
      where m.status='ended'
        and m.stats_recorded_at is not null
    ) history
    order by sort_time,sort_id
  loop
    perform public.apply_multiplayer_length_stat(
      r.player_id,
      r.mode,
      r.word_length,
      r.result_kind,
      r.solved,
      r.attempts_used,
      r.solve_ms
    );
  end loop;
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
      select jsonb_object_agg(
        s.mode,
        jsonb_build_object(
          'matches',s.matches,
          'wins',s.wins,
          'losses',s.losses,
          'draws',s.draws,
          'currentStreak',s.current_streak,
          'maxStreak',s.max_streak,
          'solvedMatches',s.solved_matches,
          'totalSolveGuesses',s.total_solve_guesses,
          'totalSolveMs',s.total_solve_ms
        ) ||
        case
          when s.mode in ('kelimelik','classic') then
            jsonb_build_object(
              'byLength',
              coalesce((
                select jsonb_object_agg(
                  bl.word_length::text,
                  jsonb_build_object(
                    'matches',bl.matches,
                    'wins',bl.wins,
                    'losses',bl.losses,
                    'draws',bl.draws,
                    'currentStreak',bl.current_streak,
                    'maxStreak',bl.max_streak,
                    'solvedMatches',bl.solved_matches,
                    'totalSolveGuesses',bl.total_solve_guesses,
                    'totalSolveMs',bl.total_solve_ms
                  )
                )
                from public.multiplayer_stats_by_length bl
                where bl.player_id=p.id
                  and bl.mode=s.mode
              ),'{}'::jsonb)
            )
          else '{}'::jsonb
        end
      )
      from public.multiplayer_stats s
      where s.player_id=p.id
    ),'{}'::jsonb) as stats
  from public.profiles p
  where p.player_code=upper(replace(p_player_code,'#',''))
  limit 1;
$$;

revoke all on function public.get_public_profile(text) from public, anon;
grant execute on function public.get_public_profile(text) to authenticated;


create or replace function public.reset_my_multiplayer_stats()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Oturum gerekli';
  end if;

  update public.multiplayer_stats
  set matches=0,
      wins=0,
      losses=0,
      draws=0,
      current_streak=0,
      max_streak=0,
      solved_matches=0,
      total_solve_guesses=0,
      total_solve_ms=0,
      updated_at=clock_timestamp()
  where player_id=uid;

  update public.multiplayer_stats_by_length
  set matches=0,
      wins=0,
      losses=0,
      draws=0,
      current_streak=0,
      max_streak=0,
      solved_matches=0,
      total_solve_guesses=0,
      total_solve_ms=0,
      updated_at=clock_timestamp()
  where player_id=uid;

  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.reset_my_multiplayer_stats()
from public, anon;

grant execute on function public.reset_my_multiplayer_stats()
to authenticated;
