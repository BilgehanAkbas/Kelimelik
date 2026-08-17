-- Kelimelik Online v1.2.1 — Özel oda + canlı maç motoru
-- 2026-08-15
-- Bu migration, 20260815_001_online_foundation.sql sonrasında çalıştırılmalıdır.

create table if not exists public.multiplayer_answer_words (
  answer_version text not null default 'A1',
  length smallint not null check (length in (4,5,6)),
  word text not null,
  enabled boolean not null default true,
  primary key (answer_version,length,word),
  check (char_length(word)=length),
  check (word ~ '^[A-ZÇĞİÖŞÜ]+$')
);

create table if not exists public.multiplayer_guess_words (
  length smallint not null check (length in (4,5,6)),
  word text not null,
  primary key (length,word),
  check (char_length(word)=length),
  check (word ~ '^[A-ZÇĞİÖŞÜ]+$')
);

create table if not exists public.live_matches (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique check (room_code ~ '^[A-Z2-9]{6}$'),
  mode text not null check (mode in ('kelimelik','classic')),
  word_length smallint not null check (word_length in (4,5,6)),
  attempt_limit smallint not null check (attempt_limit in (5,6,7,8)),
  host_id uuid not null references public.profiles(id) on delete cascade,
  guest_id uuid references public.profiles(id) on delete set null,
  status text not null default 'waiting' check (status in ('waiting','countdown','active','ended','cancelled')),
  started_at timestamptz,
  ended_at timestamptz,
  winner_id uuid references public.profiles(id) on delete set null,
  end_reason text check (end_reason is null or end_reason in ('solved','draw','disconnect','forfeit','cancelled')),
  rematch_requested_by uuid references public.profiles(id) on delete set null,
  rematch_match_id uuid references public.live_matches(id) on delete set null,
  parent_match_id uuid references public.live_matches(id) on delete set null,
  stats_recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (mode='classic' and word_length in (4,5,6) and attempt_limit=word_length+1)
    or
    (mode='kelimelik' and word_length in (4,5,6) and attempt_limit=8)
  )
);

-- Gizli cevap istemciye hiçbir SELECT politikasıyla açılmaz.
create table if not exists public.live_match_secrets (
  match_id uuid primary key references public.live_matches(id) on delete cascade,
  answer_version text not null default 'A1',
  answer_word text not null,
  created_at timestamptz not null default now(),
  check (answer_word ~ '^[A-ZÇĞİÖŞÜ]+$')
);

create table if not exists public.live_match_players (
  match_id uuid not null references public.live_matches(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  seat smallint not null check (seat in (1,2)),
  attempts_used smallint not null default 0 check (attempts_used between 0 and 8),
  solved_at timestamptz,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (match_id,player_id),
  unique (match_id,seat)
);

create table if not exists public.live_match_guesses (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.live_matches(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  guess_no smallint not null check (guess_no between 1 and 8),
  guess_word text not null check (guess_word ~ '^[A-ZÇĞİÖŞÜ]+$'),
  feedback jsonb not null,
  solved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (match_id,player_id,guess_no)
);

create table if not exists public.live_match_reactions (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.live_matches(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (emoji in ('👍','👏','🔥','😅','😮','💀')),
  created_at timestamptz not null default now()
);

create index if not exists live_matches_room_status_idx on public.live_matches(room_code,status);
create index if not exists live_match_players_match_idx on public.live_match_players(match_id,last_seen_at);
create index if not exists live_match_guesses_match_idx on public.live_match_guesses(match_id,id);
create index if not exists live_match_reactions_match_idx on public.live_match_reactions(match_id,id);

alter table public.multiplayer_answer_words enable row level security;
alter table public.multiplayer_guess_words enable row level security;
alter table public.live_matches enable row level security;
alter table public.live_match_secrets enable row level security;
alter table public.live_match_players enable row level security;
alter table public.live_match_guesses enable row level security;
alter table public.live_match_reactions enable row level security;

-- Kelime tabloları ve secret tablosu yalnızca SECURITY DEFINER fonksiyonlarından okunur.
revoke all on public.multiplayer_answer_words from anon, authenticated;
revoke all on public.multiplayer_guess_words from anon, authenticated;
revoke all on public.live_match_secrets from anon, authenticated;

create or replace function public.is_live_match_participant(p_match_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists(
    select 1
    from public.live_matches m
    where m.id=p_match_id
      and auth.uid() is not null
      and auth.uid() in (m.host_id,m.guest_id)
  );
$$;

revoke all on function public.is_live_match_participant(uuid) from public, anon;
grant execute on function public.is_live_match_participant(uuid) to authenticated;

-- Realtime tablolarında yalnızca maça katılan iki oyuncu SELECT görebilir.
drop policy if exists "participants can read live matches" on public.live_matches;
create policy "participants can read live matches"
on public.live_matches for select
to authenticated
using (auth.uid() in (host_id,guest_id));

drop policy if exists "participants can read live players" on public.live_match_players;
create policy "participants can read live players"
on public.live_match_players for select
to authenticated
using (public.is_live_match_participant(match_id));

drop policy if exists "participants can read live guesses" on public.live_match_guesses;
create policy "participants can read live guesses"
on public.live_match_guesses for select
to authenticated
using (public.is_live_match_participant(match_id));

drop policy if exists "participants can read live reactions" on public.live_match_reactions;
create policy "participants can read live reactions"
on public.live_match_reactions for select
to authenticated
using (public.is_live_match_participant(match_id));

-- Doğrudan istemci yazımı kapalıdır. Tüm kritik değişiklikler RPC üzerinden yapılır.
revoke insert, update, delete on public.live_matches from anon, authenticated;
revoke insert, update, delete on public.live_match_players from anon, authenticated;
revoke insert, update, delete on public.live_match_guesses from anon, authenticated;
revoke insert, update, delete on public.live_match_reactions from anon, authenticated;
grant select on public.live_matches to authenticated;
grant select on public.live_match_players to authenticated;
grant select on public.live_match_guesses to authenticated;
grant select on public.live_match_reactions to authenticated;

create or replace function public.make_live_room_code()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  candidate text;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea;
  i integer;
begin
  for attempt in 1..100 loop
    bytes:=gen_random_bytes(6);
    candidate:='';
    for i in 0..5 loop
      candidate:=candidate || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
    end loop;
    if not exists(select 1 from public.live_matches m where m.room_code=candidate) then
      return candidate;
    end if;
  end loop;
  raise exception 'Oda kodu üretilemedi';
end;
$$;

create or replace function public.live_feedback(p_guess text,p_answer text)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  n integer := char_length(p_answer);
  result text[];
  pool text[];
  i integer;
  j integer;
  ch text;
  greens integer := 0;
  yellows integer := 0;
  reds integer := 0;
begin
  if char_length(p_guess)<>n then
    raise exception 'Tahmin ve cevap uzunluğu aynı olmalı';
  end if;

  result := array_fill('red'::text,array[n]);
  pool := array_fill(null::text,array[n]);

  for i in 1..n loop
    pool[i] := substr(p_answer,i,1);
  end loop;

  for i in 1..n loop
    if substr(p_guess,i,1)=substr(p_answer,i,1) then
      result[i] := 'green';
      pool[i] := null;
    end if;
  end loop;

  for i in 1..n loop
    if result[i]='green' then
      continue;
    end if;
    ch := substr(p_guess,i,1);
    for j in 1..n loop
      if pool[j]=ch then
        result[i] := 'yellow';
        pool[j] := null;
        exit;
      end if;
    end loop;
  end loop;

  for i in 1..n loop
    if result[i]='green' then greens:=greens+1;
    elsif result[i]='yellow' then yellows:=yellows+1;
    else reds:=reds+1;
    end if;
  end loop;

  return jsonb_build_object(
    'green',greens,
    'yellow',yellows,
    'red',reds,
    'pattern',to_jsonb(result)
  );
end;
$$;

-- Tek bir maçı, gizli cevabı açmadan istemciye uygun JSON olarak döndürür.
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
    'lastSeenAt',p.last_seen_at
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
    'lastSeenAt',p.last_seen_at
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

create or replace function public.create_private_live_match(p_mode text,p_length integer)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_mode text := lower(btrim(coalesce(p_mode,'')));
  requested_length integer := p_length;
  secret text;
  match_id uuid := gen_random_uuid();
  code text;
  attempts integer;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  if not exists(select 1 from public.profiles where id=uid) then
    raise exception 'Önce oyuncu profili oluştur';
  end if;

  if clean_mode='classic' and requested_length in (4,5,6) then
    attempts:=requested_length+1;
  elsif clean_mode='kelimelik' and requested_length in (4,5,6) then
    attempts:=8;
  else
    raise exception 'Geçersiz oyun modu';
  end if;

  select aw.word into secret
  from public.multiplayer_answer_words aw
  where aw.answer_version='A1' and aw.length=requested_length and aw.enabled
  order by random()
  limit 1;

  if secret is null then raise exception 'Online cevap havuzu yüklenmemiş'; end if;

  code:=public.make_live_room_code();

  insert into public.live_matches(
    id,room_code,mode,word_length,attempt_limit,host_id,status
  ) values(
    match_id,code,clean_mode,requested_length,attempts,uid,'waiting'
  );

  insert into public.live_match_secrets(match_id,answer_version,answer_word)
  values(match_id,'A1',secret);

  insert into public.live_match_players(match_id,player_id,seat)
  values(match_id,uid,1);

  return public.get_live_match_state(match_id);
end;
$$;

create or replace function public.join_private_live_match(p_room_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  code text := upper(btrim(coalesce(p_room_code,'')));
  m public.live_matches%rowtype;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  if code !~ '^[A-Z2-9]{6}$' then raise exception 'Geçersiz oda kodu'; end if;
  if not exists(select 1 from public.profiles where id=uid) then
    raise exception 'Önce oyuncu profili oluştur';
  end if;

  select * into m
  from public.live_matches
  where room_code=code
  for update;

  if not found then raise exception 'Oda bulunamadı'; end if;

  if uid=m.host_id or uid=m.guest_id then
    update public.live_match_players
      set last_seen_at=clock_timestamp()
      where match_id=m.id and player_id=uid;
    return public.get_live_match_state(m.id);
  end if;

  if m.status<>'waiting' or m.guest_id is not null then
    raise exception 'Bu oda artık katılıma açık değil';
  end if;

  update public.live_matches
  set guest_id=uid,
      status='countdown',
      started_at=clock_timestamp()+interval '4 seconds',
      updated_at=clock_timestamp()
  where id=m.id;

  insert into public.live_match_players(match_id,player_id,seat)
  values(m.id,uid,2);

  return public.get_live_match_state(m.id);
end;
$$;

create or replace function public.heartbeat_live_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  m public.live_matches%rowtype;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;

  select * into m from public.live_matches where id=p_match_id for update;
  if not found or uid not in (m.host_id,m.guest_id) then raise exception 'Maça erişim yok'; end if;

  update public.live_match_players
    set last_seen_at=clock_timestamp()
    where match_id=m.id and player_id=uid;

  if m.status='countdown' and m.started_at is not null and m.started_at<=clock_timestamp() then
    update public.live_matches set status='active',updated_at=clock_timestamp() where id=m.id;
  end if;

  return public.get_live_match_state(m.id);
end;
$$;

create or replace function public.record_live_match_stats(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.live_matches%rowtype;
  p record;
  result_kind text;
  solved boolean;
  solve_ms bigint;
  stat_mode text;
begin
  select * into m from public.live_matches where id=p_match_id for update;
  if not found or m.status<>'ended' or m.stats_recorded_at is not null then return; end if;

  update public.live_matches set stats_recorded_at=clock_timestamp() where id=m.id;

  for p in
    select lp.player_id,lp.attempts_used,lp.solved_at
    from public.live_match_players lp
    where lp.match_id=m.id
  loop
    if m.winner_id is null then result_kind:='draw';
    elsif p.player_id=m.winner_id then result_kind:='win';
    else result_kind:='loss';
    end if;

    solved:=p.solved_at is not null;
    solve_ms:=case
      when solved and m.started_at is not null
      then greatest(0,floor(extract(epoch from (p.solved_at-m.started_at))*1000)::bigint)
      else 0
    end;

    foreach stat_mode in array array['overall',m.mode] loop
      insert into public.multiplayer_stats(player_id,mode)
      values(p.player_id,stat_mode)
      on conflict (player_id,mode) do nothing;

      update public.multiplayer_stats s
      set matches=s.matches+1,
          wins=s.wins+case when result_kind='win' then 1 else 0 end,
          losses=s.losses+case when result_kind='loss' then 1 else 0 end,
          draws=s.draws+case when result_kind='draw' then 1 else 0 end,
          max_streak=case when result_kind='win' then greatest(s.max_streak,s.current_streak+1) else s.max_streak end,
          current_streak=case when result_kind='win' then s.current_streak+1 else 0 end,
          solved_matches=s.solved_matches+case when solved then 1 else 0 end,
          total_solve_guesses=s.total_solve_guesses+case when solved then p.attempts_used else 0 end,
          total_solve_ms=s.total_solve_ms+case when solved then solve_ms else 0 end,
          updated_at=clock_timestamp()
      where s.player_id=p.player_id and s.mode=stat_mode;
    end loop;
  end loop;
end;
$$;

create or replace function public.submit_live_guess(p_match_id uuid,p_guess text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  m public.live_matches%rowtype;
  player public.live_match_players%rowtype;
  opponent public.live_match_players%rowtype;
  secret text;
  guess text := btrim(coalesce(p_guess,''));
  fb jsonb;
  public_fb jsonb;
  next_attempt integer;
  solved boolean;
  finished_now boolean := false;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;

  select * into m from public.live_matches where id=p_match_id for update;
  if not found or uid not in (m.host_id,m.guest_id) then raise exception 'Maça erişim yok'; end if;
  if m.guest_id is null then raise exception 'Rakip henüz katılmadı'; end if;
  if m.status in ('ended','cancelled') then return public.get_live_match_state(m.id); end if;

  if m.status='countdown' then
    if m.started_at is null or m.started_at>clock_timestamp() then raise exception 'Geri sayım henüz bitmedi'; end if;
    update public.live_matches set status='active',updated_at=clock_timestamp() where id=m.id;
    m.status:='active';
  end if;

  select * into player
  from public.live_match_players
  where match_id=m.id and player_id=uid
  for update;

  if not found then raise exception 'Oyuncu kaydı bulunamadı'; end if;
  if player.solved_at is not null then raise exception 'Bu maçı zaten tamamladın'; end if;
  if player.attempts_used>=m.attempt_limit then raise exception 'Tahmin hakkın kalmadı'; end if;

  if char_length(guess)<>m.word_length or guess !~ '^[A-ZÇĞİÖŞÜ]+$' then
    raise exception 'Geçersiz tahmin';
  end if;

  if not exists(
    select 1 from public.multiplayer_guess_words w
    where w.length=m.word_length and w.word=guess
  ) then
    raise exception 'Kelime havuzunda yok';
  end if;

  select s.answer_word into secret from public.live_match_secrets s where s.match_id=m.id;
  if secret is null then raise exception 'Maç cevabı bulunamadı'; end if;

  fb:=public.live_feedback(guess,secret);
  solved:=guess=secret;
  next_attempt:=player.attempts_used+1;

  public_fb:=case when m.mode='classic'
    then fb
    else fb-'pattern'
  end;

  insert into public.live_match_guesses(match_id,player_id,guess_no,guess_word,feedback,solved)
  values(m.id,uid,next_attempt,guess,public_fb,solved);

  update public.live_match_players
    set attempts_used=next_attempt,
        solved_at=case when solved then clock_timestamp() else solved_at end,
        last_seen_at=clock_timestamp()
    where match_id=m.id and player_id=uid;

  if solved then
    update public.live_matches
      set status='ended',winner_id=uid,end_reason='solved',ended_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=m.id and status not in ('ended','cancelled');
    finished_now:=true;
  elsif next_attempt>=m.attempt_limit then
    select * into opponent
    from public.live_match_players
    where match_id=m.id and player_id<>uid
    limit 1;

    if found and opponent.attempts_used>=m.attempt_limit and opponent.solved_at is null then
      update public.live_matches
        set status='ended',winner_id=null,end_reason='draw',ended_at=clock_timestamp(),updated_at=clock_timestamp()
        where id=m.id and status not in ('ended','cancelled');
      finished_now:=true;
    end if;
  end if;

  if finished_now then perform public.record_live_match_stats(m.id); end if;
  return public.get_live_match_state(m.id);
end;
$$;

create or replace function public.claim_live_disconnect_win(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  m public.live_matches%rowtype;
  opponent public.live_match_players%rowtype;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;

  select * into m from public.live_matches where id=p_match_id for update;
  if not found or uid not in (m.host_id,m.guest_id) then raise exception 'Maça erişim yok'; end if;
  if m.status in ('ended','cancelled') then return public.get_live_match_state(m.id); end if;
  if m.guest_id is null then return public.get_live_match_state(m.id); end if;

  update public.live_match_players
    set last_seen_at=clock_timestamp()
    where match_id=m.id and player_id=uid;

  select * into opponent
  from public.live_match_players
  where match_id=m.id and player_id<>uid
  limit 1;

  if not found or opponent.last_seen_at>clock_timestamp()-interval '20 seconds' then
    return public.get_live_match_state(m.id);
  end if;

  update public.live_matches
    set status='ended',winner_id=uid,end_reason='disconnect',ended_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=m.id;

  perform public.record_live_match_stats(m.id);
  return public.get_live_match_state(m.id);
end;
$$;

create or replace function public.leave_live_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  m public.live_matches%rowtype;
  other_id uuid;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;

  select * into m from public.live_matches where id=p_match_id for update;
  if not found or uid not in (m.host_id,m.guest_id) then raise exception 'Maça erişim yok'; end if;
  if m.status in ('ended','cancelled') then return public.get_live_match_state(m.id); end if;

  other_id:=case when uid=m.host_id then m.guest_id else m.host_id end;

  if other_id is null then
    update public.live_matches
      set status='cancelled',winner_id=null,end_reason='cancelled',ended_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=m.id;
  else
    update public.live_matches
      set status='ended',winner_id=other_id,end_reason='forfeit',ended_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=m.id;
    perform public.record_live_match_stats(m.id);
  end if;

  return public.get_live_match_state(m.id);
end;
$$;

create or replace function public.send_live_reaction(p_match_id uuid,p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_emoji text := btrim(coalesce(p_emoji,''));
  reaction_id bigint;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  if clean_emoji not in ('👍','👏','🔥','😅','😮','💀') then raise exception 'Geçersiz tepki'; end if;
  if not public.is_live_match_participant(p_match_id) then raise exception 'Maça erişim yok'; end if;

  if exists(
    select 1 from public.live_match_reactions r
    where r.match_id=p_match_id and r.sender_id=uid
      and r.created_at>clock_timestamp()-interval '1 second'
  ) then
    raise exception 'Çok hızlı tepki gönderiyorsun';
  end if;

  insert into public.live_match_reactions(match_id,sender_id,emoji)
  values(p_match_id,uid,clean_emoji)
  returning id into reaction_id;

  return jsonb_build_object('id',reaction_id,'emoji',clean_emoji,'senderId',uid,'createdAt',clock_timestamp());
end;
$$;

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

  if m.rematch_match_id is not null then
    return public.get_live_match_state(m.rematch_match_id);
  end if;

  if m.rematch_requested_by is null then
    update public.live_matches set rematch_requested_by=uid,updated_at=clock_timestamp() where id=m.id;
    return public.get_live_match_state(m.id);
  end if;

  if m.rematch_requested_by=uid then
    return public.get_live_match_state(m.id);
  end if;

  select answer_word into old_secret from public.live_match_secrets where match_id=m.id;

  select aw.word into new_secret
  from public.multiplayer_answer_words aw
  where aw.answer_version='A1'
    and aw.length=m.word_length
    and aw.enabled
    and aw.word<>old_secret
  order by random()
  limit 1;

  if new_secret is null then raise exception 'Rövanş cevabı seçilemedi'; end if;
  new_code:=public.make_live_room_code();

  insert into public.live_matches(
    id,room_code,mode,word_length,attempt_limit,host_id,guest_id,status,started_at,parent_match_id
  ) values(
    new_id,new_code,m.mode,m.word_length,m.attempt_limit,m.host_id,m.guest_id,'countdown',clock_timestamp()+interval '4 seconds',m.id
  );

  insert into public.live_match_secrets(match_id,answer_version,answer_word)
  values(new_id,'A1',new_secret);

  insert into public.live_match_players(match_id,player_id,seat)
  values(new_id,m.host_id,1),(new_id,m.guest_id,2);

  update public.live_matches
    set rematch_match_id=new_id,rematch_requested_by=null,updated_at=clock_timestamp()
    where id=m.id;

  return public.get_live_match_state(new_id);
end;
$$;

-- Public API izinleri. Yardımcı fonksiyonlar doğrudan istemciden çağrılmasın.
revoke all on function public.make_live_room_code() from public, anon, authenticated;
revoke all on function public.live_feedback(text,text) from public, anon, authenticated;
revoke all on function public.get_live_match_state(uuid) from public, anon;
revoke all on function public.create_private_live_match(text,integer) from public, anon;
revoke all on function public.join_private_live_match(text) from public, anon;
revoke all on function public.heartbeat_live_match(uuid) from public, anon;
revoke all on function public.record_live_match_stats(uuid) from public, anon, authenticated;
revoke all on function public.submit_live_guess(uuid,text) from public, anon;
revoke all on function public.claim_live_disconnect_win(uuid) from public, anon;
revoke all on function public.leave_live_match(uuid) from public, anon;
revoke all on function public.send_live_reaction(uuid,text) from public, anon;
revoke all on function public.request_live_rematch(uuid) from public, anon;

grant execute on function public.get_live_match_state(uuid) to authenticated;
grant execute on function public.create_private_live_match(text,integer) to authenticated;
grant execute on function public.join_private_live_match(text) to authenticated;
grant execute on function public.heartbeat_live_match(uuid) to authenticated;
grant execute on function public.submit_live_guess(uuid,text) to authenticated;
grant execute on function public.claim_live_disconnect_win(uuid) to authenticated;
grant execute on function public.leave_live_match(uuid) to authenticated;
grant execute on function public.send_live_reaction(uuid,text) to authenticated;
grant execute on function public.request_live_rematch(uuid) to authenticated;

-- Realtime/Postgres Changes için tabloları publication'a idempotent ekle.
do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='live_matches') then
    alter publication supabase_realtime add table public.live_matches;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='live_match_players') then
    alter publication supabase_realtime add table public.live_match_players;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='live_match_guesses') then
    alter publication supabase_realtime add table public.live_match_guesses;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='live_match_reactions') then
    alter publication supabase_realtime add table public.live_match_reactions;
  end if;
end $$;
