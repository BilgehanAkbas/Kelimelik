-- Kelimelik Online v1.2.2 — Hızlı Eşleşme + Bot Rakip
-- 2026-08-15
-- 001, 002 ve 003 migration'larından sonra çalıştırılmalıdır.

alter table public.live_matches
  add column if not exists match_kind text not null default 'private';

alter table public.live_matches
  drop constraint if exists live_matches_match_kind_check;
alter table public.live_matches
  add constraint live_matches_match_kind_check check (match_kind in ('private','quick'));

-- Hızlı eşleşme kuyruğu. İstemci tabloya doğrudan yazmaz; RPC kullanır.
create table if not exists public.quick_match_queue (
  player_id uuid primary key references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('kelimelik','classic')),
  word_length smallint not null check (word_length in (4,5,6)),
  performance_score numeric(8,3) not null default 0,
  status text not null default 'waiting' check (status in ('waiting','matched')),
  match_id uuid references public.live_matches(id) on delete set null,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((mode='classic' and word_length in (4,5,6)) or (mode='kelimelik' and word_length in (4,5,6)))
);

create index if not exists quick_match_queue_search_idx
  on public.quick_match_queue(mode,word_length,status,last_seen_at,joined_at);

alter table public.quick_match_queue enable row level security;
revoke all on public.quick_match_queue from anon, authenticated;

-- Bot maçları canlı insan maçlarından ayrı tutulur. Böylece auth.users altında sahte bot hesabı gerekmez.
create table if not exists public.bot_matches (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('kelimelik','classic')),
  word_length smallint not null check (word_length in (4,5,6)),
  attempt_limit smallint not null check (attempt_limit in (5,6,7,8)),
  bot_key text not null check (bot_key in ('efe','defne','atlas')),
  bot_target_attempt smallint not null check (bot_target_attempt between 2 and 9),
  status text not null default 'countdown' check (status in ('countdown','active','ended','cancelled')),
  started_at timestamptz not null,
  ended_at timestamptz,
  winner_kind text check (winner_kind is null or winner_kind in ('human','bot','draw')),
  end_reason text check (end_reason is null or end_reason in ('solved','draw','forfeit','cancelled')),
  player_attempts_used smallint not null default 0 check (player_attempts_used between 0 and 8),
  player_solved_at timestamptz,
  bot_attempts_used smallint not null default 0 check (bot_attempts_used between 0 and 8),
  bot_solved_at timestamptz,
  bot_next_guess_at timestamptz,
  parent_match_id uuid references public.bot_matches(id) on delete set null,
  stats_recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (mode='classic' and word_length in (4,5,6) and attempt_limit=word_length+1)
    or
    (mode='kelimelik' and word_length in (4,5,6) and attempt_limit=8)
  )
);

create table if not exists public.bot_match_secrets (
  match_id uuid primary key references public.bot_matches(id) on delete cascade,
  answer_version text not null default 'A1',
  answer_word text not null check (answer_word ~ '^[A-ZÇĞİÖŞÜ]+$'),
  created_at timestamptz not null default now()
);

create table if not exists public.bot_match_guesses (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.bot_matches(id) on delete cascade,
  actor text not null check (actor in ('human','bot')),
  guess_no smallint not null check (guess_no between 1 and 8),
  guess_word text not null check (guess_word ~ '^[A-ZÇĞİÖŞÜ]+$'),
  feedback jsonb not null,
  solved boolean not null default false,
  created_at timestamptz not null default now(),
  unique(match_id,actor,guess_no)
);

create index if not exists bot_matches_player_idx on public.bot_matches(player_id,created_at desc);
create index if not exists bot_match_guesses_match_idx on public.bot_match_guesses(match_id,id);

alter table public.bot_matches enable row level security;
alter table public.bot_match_secrets enable row level security;
alter table public.bot_match_guesses enable row level security;
revoke all on public.bot_matches from anon, authenticated;
revoke all on public.bot_match_secrets from anon, authenticated;
revoke all on public.bot_match_guesses from anon, authenticated;

-- v1.2.2 state çıktısı matchKind içerir; gizli cevap yine açılmaz.
create or replace function public.get_live_match_state(p_match_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  m public.live_matches%rowtype;
  me_player jsonb;
  opponent_player jsonb;
  guess_rows jsonb;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;

  select * into m from public.live_matches where id=p_match_id;
  if not found or uid not in (m.host_id,m.guest_id) then
    raise exception 'Maça erişim yok';
  end if;

  select jsonb_build_object(
    'id',p.player_id,
    'nickname',pr.nickname,
    'playerCode',pr.player_code,
    'seat',p.seat,
    'attemptsUsed',p.attempts_used,
    'solvedAt',p.solved_at,
    'joinedAt',p.joined_at,
    'lastSeenAt',p.last_seen_at,
    'isBot',false
  ) into me_player
  from public.live_match_players p
  join public.profiles pr on pr.id=p.player_id
  where p.match_id=m.id and p.player_id=uid;

  select jsonb_build_object(
    'id',p.player_id,
    'nickname',pr.nickname,
    'playerCode',pr.player_code,
    'seat',p.seat,
    'attemptsUsed',p.attempts_used,
    'solvedAt',p.solved_at,
    'joinedAt',p.joined_at,
    'lastSeenAt',p.last_seen_at,
    'isBot',false
  ) into opponent_player
  from public.live_match_players p
  join public.profiles pr on pr.id=p.player_id
  where p.match_id=m.id and p.player_id<>uid
  order by p.seat
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',g.id,
    'playerId',g.player_id,
    'guessNo',g.guess_no,
    'guessWord',g.guess_word,
    'feedback',g.feedback,
    'solved',g.solved,
    'createdAt',g.created_at
  ) order by g.id),'[]'::jsonb)
  into guess_rows
  from public.live_match_guesses g
  where g.match_id=m.id;

  return jsonb_build_object(
    'id',m.id,
    'matchKind',m.match_kind,
    'roomCode',m.room_code,
    'mode',m.mode,
    'wordLength',m.word_length,
    'attemptLimit',m.attempt_limit,
    'status',m.status,
    'startedAt',m.started_at,
    'endedAt',m.ended_at,
    'winnerId',m.winner_id,
    'endReason',m.end_reason,
    'rematchRequestedByMe',m.rematch_requested_by=uid,
    'rematchRequestedByOpponent',m.rematch_requested_by is not null and m.rematch_requested_by<>uid,
    'rematchMatchId',m.rematch_match_id,
    'parentMatchId',m.parent_match_id,
    'createdAt',m.created_at,
    'serverNow',clock_timestamp(),
    'me',me_player,
    'opponent',opponent_player,
    'guesses',guess_rows
  );
end;
$$;

create or replace function public.quick_performance_score(p_player_id uuid,p_mode text)
returns numeric
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select round((
    case when s.matches>0 then (s.wins::numeric/s.matches)*100 else 50 end
    - case when s.solved_matches>0 then (s.total_solve_guesses::numeric/s.solved_matches)*4 else 20 end
    + least(s.matches,50)::numeric*0.20
  ),3)
  from public.multiplayer_stats s
  where s.player_id=p_player_id and s.mode=p_mode
  limit 1;
$$;

create or replace function public.enter_quick_match(p_mode text,p_length integer)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_mode text := lower(btrim(coalesce(p_mode,'')));
  clean_length integer := p_length;
  attempts integer;
  my_score numeric := 0;
  mine public.quick_match_queue%rowtype;
  candidate public.quick_match_queue%rowtype;
  existing_match public.live_matches%rowtype;
  new_match_id uuid := gen_random_uuid();
  room_code text;
  secret text;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  if not exists(select 1 from public.profiles where id=uid) then raise exception 'Önce oyuncu profili oluştur'; end if;

  if clean_mode='classic' and clean_length in (4,5,6) then
    attempts:=clean_length+1;
  elsif clean_mode='kelimelik' and clean_length in (4,5,6) then
    attempts:=8;
  else
    raise exception 'Geçersiz oyun modu';
  end if;

  -- Aynı mod/uzunluk kuyruğunu kısa transaction kilidiyle sırala; çift eşleşme yarışını engeller.
  perform pg_advisory_xact_lock(hashtext('kelimelik-quick:'||clean_mode||':'||clean_length::text));

  delete from public.quick_match_queue
  where status='waiting' and last_seen_at<clock_timestamp()-interval '45 seconds';
  delete from public.quick_match_queue
  where status='matched' and updated_at<clock_timestamp()-interval '15 minutes';

  select * into mine from public.quick_match_queue where player_id=uid for update;
  if found and mine.status='matched' and mine.match_id is not null then
    select * into existing_match from public.live_matches where id=mine.match_id;
    if found and existing_match.status not in ('ended','cancelled') then
      return jsonb_build_object('status','matched','match',public.get_live_match_state(mine.match_id),'serverNow',clock_timestamp());
    end if;
    delete from public.quick_match_queue where player_id=uid;
  end if;

  select coalesce(public.quick_performance_score(uid,clean_mode),30) into my_score;

  insert into public.quick_match_queue as ownq(player_id,mode,word_length,performance_score,status,match_id,joined_at,last_seen_at,updated_at)
  values(uid,clean_mode,clean_length,my_score,'waiting',null,clock_timestamp(),clock_timestamp(),clock_timestamp())
  on conflict (player_id) do update
    set mode=excluded.mode,
        word_length=excluded.word_length,
        performance_score=excluded.performance_score,
        status='waiting',
        match_id=null,
        joined_at=case
          when ownq.status='waiting'
            and ownq.mode=excluded.mode
            and ownq.word_length=excluded.word_length
          then ownq.joined_at
          else clock_timestamp()
        end,
        last_seen_at=clock_timestamp(),
        updated_at=clock_timestamp();

  select q.* into candidate
  from public.quick_match_queue q
  where q.player_id<>uid
    and q.status='waiting'
    and q.mode=clean_mode
    and q.word_length=clean_length
    and q.last_seen_at>clock_timestamp()-interval '15 seconds'
  order by abs(q.performance_score-my_score),q.joined_at
  limit 1
  for update skip locked;

  if found then
    -- Candidate aynı anda başka biri tarafından eşleştirilmişse yeniden kontrol et.
    if candidate.status<>'waiting' then
      return jsonb_build_object('status','waiting','joinedAt',(select joined_at from public.quick_match_queue where player_id=uid),'serverNow',clock_timestamp());
    end if;

    select aw.word into secret
    from public.multiplayer_answer_words aw
    where aw.answer_version='A1' and aw.length=clean_length and aw.enabled
    order by random()
    limit 1;
    if secret is null then raise exception 'Online cevap havuzu yüklenmemiş'; end if;

    room_code:=public.make_live_room_code();
    insert into public.live_matches(
      id,room_code,mode,word_length,attempt_limit,host_id,guest_id,status,started_at,match_kind
    ) values(
      new_match_id,room_code,clean_mode,clean_length,attempts,candidate.player_id,uid,'countdown',clock_timestamp()+interval '4 seconds','quick'
    );

    insert into public.live_match_secrets(match_id,answer_version,answer_word)
    values(new_match_id,'A1',secret);

    insert into public.live_match_players(match_id,player_id,seat)
    values(new_match_id,candidate.player_id,1),(new_match_id,uid,2);

    update public.quick_match_queue
      set status='matched',match_id=new_match_id,last_seen_at=clock_timestamp(),updated_at=clock_timestamp()
      where player_id in (uid,candidate.player_id);

    return jsonb_build_object('status','matched','match',public.get_live_match_state(new_match_id),'serverNow',clock_timestamp());
  end if;

  return jsonb_build_object(
    'status','waiting',
    'mode',clean_mode,
    'wordLength',clean_length,
    'joinedAt',(select joined_at from public.quick_match_queue where player_id=uid),
    'serverNow',clock_timestamp()
  );
end;
$$;

create or replace function public.poll_quick_match()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  q public.quick_match_queue%rowtype;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  select * into q from public.quick_match_queue where player_id=uid;
  if not found then return jsonb_build_object('status','idle','serverNow',clock_timestamp()); end if;
  if q.status='matched' and q.match_id is not null then
    return jsonb_build_object('status','matched','match',public.get_live_match_state(q.match_id),'serverNow',clock_timestamp());
  end if;
  return public.enter_quick_match(q.mode,q.word_length);
end;
$$;

create or replace function public.cancel_quick_match()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  q public.quick_match_queue%rowtype;
  m public.live_matches%rowtype;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  select * into q from public.quick_match_queue where player_id=uid for update;
  if not found then return jsonb_build_object('status','idle','serverNow',clock_timestamp()); end if;

  if q.status='matched' and q.match_id is not null then
    select * into m from public.live_matches where id=q.match_id;
    if found and m.status not in ('ended','cancelled') then
      return jsonb_build_object('status','matched','match',public.get_live_match_state(q.match_id),'serverNow',clock_timestamp());
    end if;
  end if;

  delete from public.quick_match_queue where player_id=uid;
  return jsonb_build_object('status','cancelled','serverNow',clock_timestamp());
end;
$$;

create or replace function public.bot_name(p_bot_key text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case lower(p_bot_key) when 'efe' then 'Efe' when 'defne' then 'Defne' when 'atlas' then 'Atlas' else 'Defne' end;
$$;

create or replace function public.bot_delay_seconds(p_bot_key text)
returns integer
language plpgsql
volatile
set search_path = public, pg_temp
as $$
begin
  return case lower(p_bot_key)
    when 'efe' then 5 + floor(random()*5)::integer       -- 5–9 sn
    when 'atlas' then 12 + floor(random()*9)::integer    -- 12–20 sn
    else 8 + floor(random()*7)::integer                  -- 8–14 sn
  end;
end;
$$;

create or replace function public.pick_bot_decoy(p_match_id uuid,p_answer text,p_length integer,p_bot_key text)
returns text
language plpgsql
security definer
volatile
set search_path = public, pg_temp
as $$
declare
  chosen text;
begin
  if lower(p_bot_key)='efe' then
    select w.word into chosen
    from public.multiplayer_guess_words w
    where w.length=p_length and w.word<>p_answer
      and not exists(
        select 1 from public.bot_match_guesses g
        where g.match_id=p_match_id and g.actor='bot' and g.guess_word=w.word
      )
    order by random()
    limit 1;
  else
    select s.word into chosen
    from (
      select w.word
      from public.multiplayer_guess_words w
      where w.length=p_length and w.word<>p_answer
        and not exists(
          select 1 from public.bot_match_guesses g
          where g.match_id=p_match_id and g.actor='bot' and g.guess_word=w.word
        )
      order by random()
      limit 140
    ) s
    order by (
      ((public.live_feedback(s.word,p_answer)->>'green')::integer * case when lower(p_bot_key)='atlas' then 4 else 3 end)
      + ((public.live_feedback(s.word,p_answer)->>'yellow')::integer * case when lower(p_bot_key)='atlas' then 2 else 1 end)
      + random()*case when lower(p_bot_key)='atlas' then 1.5 else 4 end
    ) desc
    limit 1;
  end if;
  return chosen;
end;
$$;

create or replace function public.get_bot_match_state(p_match_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  m public.bot_matches%rowtype;
  pr public.profiles%rowtype;
  me_player jsonb;
  bot_player jsonb;
  guess_rows jsonb;
  winner_id text;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  select * into m from public.bot_matches where id=p_match_id;
  if not found or m.player_id<>uid then raise exception 'Maça erişim yok'; end if;
  select * into pr from public.profiles where id=uid;

  me_player:=jsonb_build_object(
    'id',uid,
    'nickname',pr.nickname,
    'playerCode',pr.player_code,
    'seat',1,
    'attemptsUsed',m.player_attempts_used,
    'solvedAt',m.player_solved_at,
    'joinedAt',m.created_at,
    'lastSeenAt',clock_timestamp(),
    'isBot',false
  );

  bot_player:=jsonb_build_object(
    'id','bot:'||m.bot_key,
    'nickname',public.bot_name(m.bot_key),
    'playerCode','BOT',
    'seat',2,
    'attemptsUsed',m.bot_attempts_used,
    'solvedAt',m.bot_solved_at,
    'joinedAt',m.created_at,
    'lastSeenAt',clock_timestamp(),
    'isBot',true,
    'botKey',m.bot_key
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',g.id,
    'playerId',case when g.actor='human' then uid::text else 'bot:'||m.bot_key end,
    'guessNo',g.guess_no,
    'guessWord',g.guess_word,
    'feedback',g.feedback,
    'solved',g.solved,
    'createdAt',g.created_at
  ) order by g.id),'[]'::jsonb)
  into guess_rows
  from public.bot_match_guesses g
  where g.match_id=m.id;

  winner_id:=case
    when m.winner_kind='human' then uid::text
    when m.winner_kind='bot' then 'bot:'||m.bot_key
    else null
  end;

  return jsonb_build_object(
    'id',m.id,
    'matchKind','bot',
    'roomCode',null,
    'mode',m.mode,
    'wordLength',m.word_length,
    'attemptLimit',m.attempt_limit,
    'status',m.status,
    'startedAt',m.started_at,
    'endedAt',m.ended_at,
    'winnerId',winner_id,
    'endReason',m.end_reason,
    'rematchRequestedByMe',false,
    'rematchRequestedByOpponent',false,
    'rematchMatchId',null,
    'parentMatchId',m.parent_match_id,
    'createdAt',m.created_at,
    'serverNow',clock_timestamp(),
    'me',me_player,
    'opponent',bot_player,
    'guesses',guess_rows
  );
end;
$$;

create or replace function public.record_bot_match_stats(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.bot_matches%rowtype;
  result_kind text;
  solved boolean;
  solve_ms bigint;
  stat_mode text;
begin
  select * into m from public.bot_matches where id=p_match_id for update;
  if not found or m.status<>'ended' or m.stats_recorded_at is not null then return; end if;

  update public.bot_matches set stats_recorded_at=clock_timestamp() where id=m.id;
  result_kind:=case when m.winner_kind='human' then 'win' when m.winner_kind='bot' then 'loss' else 'draw' end;
  solved:=m.player_solved_at is not null;
  solve_ms:=case when solved then greatest(0,floor(extract(epoch from (m.player_solved_at-m.started_at))*1000)::bigint) else 0 end;

  foreach stat_mode in array array['overall',m.mode] loop
    insert into public.multiplayer_stats(player_id,mode)
    values(m.player_id,stat_mode)
    on conflict (player_id,mode) do nothing;

    update public.multiplayer_stats s
    set matches=s.matches+1,
        wins=s.wins+case when result_kind='win' then 1 else 0 end,
        losses=s.losses+case when result_kind='loss' then 1 else 0 end,
        draws=s.draws+case when result_kind='draw' then 1 else 0 end,
        max_streak=case when result_kind='win' then greatest(s.max_streak,s.current_streak+1) else s.max_streak end,
        current_streak=case when result_kind='win' then s.current_streak+1 else 0 end,
        solved_matches=s.solved_matches+case when solved then 1 else 0 end,
        total_solve_guesses=s.total_solve_guesses+case when solved then m.player_attempts_used else 0 end,
        total_solve_ms=s.total_solve_ms+case when solved then solve_ms else 0 end,
        updated_at=clock_timestamp()
    where s.player_id=m.player_id and s.mode=stat_mode;
  end loop;
end;
$$;

create or replace function public.create_bot_match(p_mode text,p_length integer,p_bot_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_mode text := lower(btrim(coalesce(p_mode,'')));
  clean_length integer := p_length;
  clean_bot text := lower(btrim(coalesce(p_bot_key,'')));
  attempts integer;
  secret text;
  match_id uuid := gen_random_uuid();
  target integer;
  start_time timestamptz := clock_timestamp()+interval '4 seconds';
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  if not exists(select 1 from public.profiles where id=uid) then raise exception 'Önce oyuncu profili oluştur'; end if;

  if clean_mode='classic' and clean_length in (4,5,6) then attempts:=clean_length+1;
  elsif clean_mode='kelimelik' and clean_length in (4,5,6) then attempts:=8;
  else raise exception 'Geçersiz oyun modu'; end if;

  if clean_bot not in ('efe','defne','atlas') then
    clean_bot:=(array['efe','defne','atlas'])[1+floor(random()*3)::integer];
  end if;

  select aw.word into secret from public.multiplayer_answer_words aw
  where aw.answer_version='A1' and aw.length=clean_length and aw.enabled
  order by random() limit 1;
  if secret is null then raise exception 'Online cevap havuzu yüklenmemiş'; end if;

  target:=case clean_bot
    when 'efe' then 2+floor(random()*attempts)::integer
    when 'atlas' then 2+floor(random()*least(attempts,4))::integer
    else 2+floor(random()*greatest(2,attempts-1))::integer
  end;

  insert into public.bot_matches(
    id,player_id,mode,word_length,attempt_limit,bot_key,bot_target_attempt,status,started_at,bot_next_guess_at
  ) values(
    match_id,uid,clean_mode,clean_length,attempts,clean_bot,target,'countdown',start_time,
    start_time + make_interval(secs=>public.bot_delay_seconds(clean_bot))
  );
  insert into public.bot_match_secrets(match_id,answer_version,answer_word) values(match_id,'A1',secret);
  return public.get_bot_match_state(match_id);
end;
$$;

create or replace function public.advance_bot_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  m public.bot_matches%rowtype;
  secret text;
  guess text;
  fb jsonb;
  public_fb jsonb;
  next_attempt integer;
  solved boolean;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  select * into m from public.bot_matches where id=p_match_id for update;
  if not found or m.player_id<>uid then raise exception 'Maça erişim yok'; end if;
  if m.status in ('ended','cancelled') then return public.get_bot_match_state(m.id); end if;

  if m.status='countdown' then
    if m.started_at>clock_timestamp() then return public.get_bot_match_state(m.id); end if;
    update public.bot_matches set status='active',updated_at=clock_timestamp() where id=m.id;
    m.status:='active';
  end if;

  if m.status='active'
    and m.bot_attempts_used<m.attempt_limit
    and m.bot_solved_at is null
    and m.bot_next_guess_at is not null
    and m.bot_next_guess_at<=clock_timestamp()
  then
    select answer_word into secret from public.bot_match_secrets where match_id=m.id;
    next_attempt:=m.bot_attempts_used+1;
    if next_attempt=m.bot_target_attempt and m.bot_target_attempt<=m.attempt_limit then
      guess:=secret;
    else
      guess:=public.pick_bot_decoy(m.id,secret,m.word_length,m.bot_key);
    end if;
    if guess is null then
      select w.word into guess from public.multiplayer_guess_words w
      where w.length=m.word_length and w.word<>secret order by random() limit 1;
    end if;

    fb:=public.live_feedback(guess,secret);
    solved:=guess=secret;
    public_fb:=case when m.mode='classic' then fb else fb-'pattern' end;

    insert into public.bot_match_guesses(match_id,actor,guess_no,guess_word,feedback,solved)
    values(m.id,'bot',next_attempt,guess,public_fb,solved);

    update public.bot_matches
    set bot_attempts_used=next_attempt,
        bot_solved_at=case when solved then clock_timestamp() else bot_solved_at end,
        bot_next_guess_at=case when solved or next_attempt>=attempt_limit then null else clock_timestamp()+make_interval(secs=>public.bot_delay_seconds(bot_key)) end,
        updated_at=clock_timestamp()
    where id=m.id;

    if solved then
      update public.bot_matches set status='ended',winner_kind='bot',end_reason='solved',ended_at=clock_timestamp(),updated_at=clock_timestamp() where id=m.id;
      perform public.record_bot_match_stats(m.id);
    elsif next_attempt>=m.attempt_limit and m.player_attempts_used>=m.attempt_limit and m.player_solved_at is null then
      update public.bot_matches set status='ended',winner_kind='draw',end_reason='draw',ended_at=clock_timestamp(),updated_at=clock_timestamp() where id=m.id;
      perform public.record_bot_match_stats(m.id);
    end if;
  end if;

  return public.get_bot_match_state(m.id);
end;
$$;

create or replace function public.submit_bot_match_guess(p_match_id uuid,p_guess text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  m public.bot_matches%rowtype;
  secret text;
  guess text := upper(btrim(coalesce(p_guess,'')));
  fb jsonb;
  public_fb jsonb;
  next_attempt integer;
  solved boolean;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;

  -- Botun süresi dolmuşsa insan tahmininden önce server saatiyle hamlesini işlet.
  perform public.advance_bot_match(p_match_id);
  select * into m from public.bot_matches where id=p_match_id for update;
  if not found or m.player_id<>uid then raise exception 'Maça erişim yok'; end if;
  if m.status in ('ended','cancelled') then return public.get_bot_match_state(m.id); end if;
  if m.status<>'active' then raise exception 'Geri sayım henüz bitmedi'; end if;
  if m.player_solved_at is not null then raise exception 'Bu maçı zaten tamamladın'; end if;
  if m.player_attempts_used>=m.attempt_limit then raise exception 'Tahmin hakkın kalmadı'; end if;

  if char_length(guess)<>m.word_length or guess !~ '^[A-ZÇĞİÖŞÜ]+$' then raise exception 'Geçersiz tahmin'; end if;
  if not exists(select 1 from public.multiplayer_guess_words w where w.length=m.word_length and w.word=guess) then
    raise exception 'Kelime havuzunda yok';
  end if;

  select answer_word into secret from public.bot_match_secrets where match_id=m.id;
  fb:=public.live_feedback(guess,secret);
  solved:=guess=secret;
  next_attempt:=m.player_attempts_used+1;
  public_fb:=case when m.mode='classic' then fb else fb-'pattern' end;

  insert into public.bot_match_guesses(match_id,actor,guess_no,guess_word,feedback,solved)
  values(m.id,'human',next_attempt,guess,public_fb,solved);

  update public.bot_matches
  set player_attempts_used=next_attempt,
      player_solved_at=case when solved then clock_timestamp() else player_solved_at end,
      updated_at=clock_timestamp()
  where id=m.id;

  if solved then
    update public.bot_matches set status='ended',winner_kind='human',end_reason='solved',ended_at=clock_timestamp(),updated_at=clock_timestamp() where id=m.id;
    perform public.record_bot_match_stats(m.id);
  elsif next_attempt>=m.attempt_limit and m.bot_attempts_used>=m.attempt_limit and m.bot_solved_at is null then
    update public.bot_matches set status='ended',winner_kind='draw',end_reason='draw',ended_at=clock_timestamp(),updated_at=clock_timestamp() where id=m.id;
    perform public.record_bot_match_stats(m.id);
  end if;

  return public.get_bot_match_state(m.id);
end;
$$;

create or replace function public.leave_bot_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  m public.bot_matches%rowtype;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  select * into m from public.bot_matches where id=p_match_id for update;
  if not found or m.player_id<>uid then raise exception 'Maça erişim yok'; end if;
  if m.status in ('ended','cancelled') then return public.get_bot_match_state(m.id); end if;
  update public.bot_matches set status='ended',winner_kind='bot',end_reason='forfeit',ended_at=clock_timestamp(),updated_at=clock_timestamp() where id=m.id;
  perform public.record_bot_match_stats(m.id);
  return public.get_bot_match_state(m.id);
end;
$$;

create or replace function public.create_bot_rematch(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  old_match public.bot_matches%rowtype;
  state jsonb;
  new_id uuid;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  select * into old_match from public.bot_matches where id=p_match_id;
  if not found or old_match.player_id<>uid then raise exception 'Maça erişim yok'; end if;
  if old_match.status<>'ended' then raise exception 'Rövanş şu anda kullanılamıyor'; end if;
  state:=public.create_bot_match(old_match.mode,old_match.word_length,old_match.bot_key);
  new_id:=(state->>'id')::uuid;
  update public.bot_matches set parent_match_id=old_match.id where id=new_id;
  return public.get_bot_match_state(new_id);
end;
$$;

-- Quick maçtan gelen rövanşın tekrar davet URL'sine dönüşmemesi için match_kind korunur.
create or replace function public.request_live_rematch(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  uid uuid := auth.uid();
  m public.live_matches%rowtype;
  old_secret text;
  new_secret text;
  new_id uuid := gen_random_uuid();
  new_code text;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  select * into m from public.live_matches where id=p_match_id for update;
  if not found or uid not in (m.host_id,m.guest_id) then raise exception 'Maça erişim yok'; end if;
  if m.status<>'ended' or m.guest_id is null then raise exception 'Rövanş şu anda kullanılamıyor'; end if;
  if m.rematch_match_id is not null then return public.get_live_match_state(m.rematch_match_id); end if;
  if m.rematch_requested_by is null then
    update public.live_matches set rematch_requested_by=uid,updated_at=clock_timestamp() where id=m.id;
    return public.get_live_match_state(m.id);
  end if;
  if m.rematch_requested_by=uid then return public.get_live_match_state(m.id); end if;

  select answer_word into old_secret from public.live_match_secrets where match_id=m.id;
  select aw.word into new_secret from public.multiplayer_answer_words aw
  where aw.answer_version='A1' and aw.length=m.word_length and aw.enabled and aw.word<>old_secret
  order by random() limit 1;
  if new_secret is null then raise exception 'Rövanş cevabı seçilemedi'; end if;
  new_code:=public.make_live_room_code();

  insert into public.live_matches(
    id,room_code,mode,word_length,attempt_limit,host_id,guest_id,status,started_at,parent_match_id,match_kind
  ) values(
    new_id,new_code,m.mode,m.word_length,m.attempt_limit,m.host_id,m.guest_id,'countdown',clock_timestamp()+interval '4 seconds',m.id,m.match_kind
  );
  insert into public.live_match_secrets(match_id,answer_version,answer_word) values(new_id,'A1',new_secret);
  insert into public.live_match_players(match_id,player_id,seat) values(new_id,m.host_id,1),(new_id,m.guest_id,2);
  update public.live_matches set rematch_match_id=new_id,rematch_requested_by=null,updated_at=clock_timestamp() where id=m.id;
  return public.get_live_match_state(new_id);
end;
$$;

-- Yardımcılar doğrudan API değil.
revoke all on function public.quick_performance_score(uuid,text) from public, anon, authenticated;
revoke all on function public.bot_name(text) from public, anon, authenticated;
revoke all on function public.bot_delay_seconds(text) from public, anon, authenticated;
revoke all on function public.pick_bot_decoy(uuid,text,integer,text) from public, anon, authenticated;
revoke all on function public.record_bot_match_stats(uuid) from public, anon, authenticated;

revoke all on function public.enter_quick_match(text,integer) from public, anon;
revoke all on function public.poll_quick_match() from public, anon;
revoke all on function public.cancel_quick_match() from public, anon;
revoke all on function public.get_bot_match_state(uuid) from public, anon;
revoke all on function public.create_bot_match(text,integer,text) from public, anon;
revoke all on function public.advance_bot_match(uuid) from public, anon;
revoke all on function public.submit_bot_match_guess(uuid,text) from public, anon;
revoke all on function public.leave_bot_match(uuid) from public, anon;
revoke all on function public.create_bot_rematch(uuid) from public, anon;

grant execute on function public.enter_quick_match(text,integer) to authenticated;
grant execute on function public.poll_quick_match() to authenticated;
grant execute on function public.cancel_quick_match() to authenticated;
grant execute on function public.get_bot_match_state(uuid) to authenticated;
grant execute on function public.create_bot_match(text,integer,text) to authenticated;
grant execute on function public.advance_bot_match(uuid) to authenticated;
grant execute on function public.submit_bot_match_guess(uuid,text) to authenticated;
grant execute on function public.leave_bot_match(uuid) to authenticated;
grant execute on function public.create_bot_rematch(uuid) to authenticated;
