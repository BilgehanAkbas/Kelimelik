-- Kelimelik v1.2.9 — Klasik Mod 4/5/6 production migration
-- Klasik: 4 harf=5 tahmin, 5 harf=6 tahmin, 6 harf=7 tahmin.
-- Kelimelik 4/5/6 = 8 tahmin olarak değişmeden kalır.

alter table public.live_matches drop constraint if exists live_matches_attempt_limit_check;
alter table public.live_matches add constraint live_matches_attempt_limit_check check (attempt_limit in (5,6,7,8));
alter table public.live_matches drop constraint if exists live_matches_check;
alter table public.live_matches add constraint live_matches_check check (
  (mode='classic' and word_length in (4,5,6) and attempt_limit=word_length+1)
  or (mode='kelimelik' and word_length in (4,5,6) and attempt_limit=8)
);

alter table public.quick_match_queue drop constraint if exists quick_match_queue_check;
alter table public.quick_match_queue add constraint quick_match_queue_check check (
  mode in ('classic','kelimelik') and word_length in (4,5,6)
);

alter table public.bot_matches drop constraint if exists bot_matches_attempt_limit_check;
alter table public.bot_matches add constraint bot_matches_attempt_limit_check check (attempt_limit in (5,6,7,8));
alter table public.bot_matches drop constraint if exists bot_matches_check;
alter table public.bot_matches add constraint bot_matches_check check (
  (mode='classic' and word_length in (4,5,6) and attempt_limit=word_length+1)
  or (mode='kelimelik' and word_length in (4,5,6) and attempt_limit=8)
);

alter table public.custom_puzzles drop constraint if exists custom_puzzles_attempt_limit_check;
alter table public.custom_puzzles add constraint custom_puzzles_attempt_limit_check check (attempt_limit in (5,6,7,8));
alter table public.custom_puzzles drop constraint if exists custom_puzzles_check;
alter table public.custom_puzzles add constraint custom_puzzles_check check (
  (mode='classic' and word_length in (4,5,6) and attempt_limit=word_length+1)
  or (mode='kelimelik' and word_length in (4,5,6) and attempt_limit=8)
);

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

create or replace function public.create_custom_puzzle(p_mode text,p_length integer,p_answer text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_mode text := lower(btrim(coalesce(p_mode,'')));
  clean_length integer := p_length;
  attempts integer;
  answer text := upper(btrim(coalesce(p_answer,'')));
  new_id uuid := gen_random_uuid();
  code text;
  expires timestamptz := clock_timestamp()+interval '90 days';
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;

  if clean_mode='classic' and clean_length in (4,5,6) then
    attempts:=clean_length+1;
  elsif clean_mode='kelimelik' and clean_length in (4,5,6) then
    attempts:=8;
  else
    raise exception 'Geçersiz oyun modu';
  end if;

  if char_length(answer)<>clean_length or answer !~ '^[A-ZÇĞİÖŞÜ]+$' then
    raise exception 'Gizli kelime seçilen harf sayısıyla uyumlu değil';
  end if;

  if not exists(
    select 1 from public.multiplayer_guess_words w
    where w.length=clean_length and w.word=answer
  ) then
    raise exception 'Bu kelime Kelimelik tahmin sözlüğünde bulunmuyor';
  end if;

  code:=public.make_custom_puzzle_code();

  insert into public.custom_puzzles(id,puzzle_code,creator_id,mode,word_length,attempt_limit,expires_at)
  values(new_id,code,uid,clean_mode,clean_length,attempts,expires);

  insert into public.custom_puzzle_secrets(puzzle_id,answer_word)
  values(new_id,answer);

  return jsonb_build_object(
    'puzzleCode',code,
    'mode',clean_mode,
    'wordLength',clean_length,
    'attemptLimit',attempts,
    'createdAt',clock_timestamp(),
    'expiresAt',expires
  );
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

-- Explicit RPC grants remain intentional: authenticated anonymous players call these controlled SECURITY DEFINER entrypoints.
revoke all on function public.create_private_live_match(text,integer) from public, anon;
grant execute on function public.create_private_live_match(text,integer) to authenticated;
revoke all on function public.enter_quick_match(text,integer) from public, anon;
grant execute on function public.enter_quick_match(text,integer) to authenticated;
revoke all on function public.create_bot_match(text,integer,text) from public, anon;
grant execute on function public.create_bot_match(text,integer,text) to authenticated;
revoke all on function public.create_custom_puzzle(text,integer,text) from public, anon;
grant execute on function public.create_custom_puzzle(text,integer,text) to authenticated;

revoke all on function public.join_private_live_match(text) from public, anon;
grant execute on function public.join_private_live_match(text) to authenticated;
revoke all on function public.heartbeat_live_match(uuid) from public, anon;
grant execute on function public.heartbeat_live_match(uuid) to authenticated;
revoke all on function public.claim_live_disconnect_win(uuid) from public, anon;
grant execute on function public.claim_live_disconnect_win(uuid) to authenticated;
revoke all on function public.leave_live_match(uuid) from public, anon;
grant execute on function public.leave_live_match(uuid) to authenticated;
