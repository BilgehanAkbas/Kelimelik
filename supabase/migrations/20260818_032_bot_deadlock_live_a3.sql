-- Kelimelik — bot deadlock guard + direct A3 live answer selection
-- 1) A bot that cannot find another fair unused probe is marked as having
--    exhausted its remaining attempts instead of leaving the match active forever.
-- 2) Human-vs-human match creators select from the current A3 answer pool directly.
--    The existing BEFORE INSERT A3 trigger remains as a second safety layer.

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
  secret_version text := 'A3';
  guess text;
  fb jsonb;
  public_fb jsonb;
  next_attempt integer;
  solved boolean;
  max_green integer := 0;
  max_present integer := 0;
  solve_floor integer := 0;
  candidate_cap integer := 1;
  candidate_count integer := 0;
  solve_ready boolean := false;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;

  select * into m
  from public.bot_matches
  where id=p_match_id
  for update;

  if not found or m.player_id<>uid then raise exception 'Maça erişim yok'; end if;
  if m.status in ('ended','cancelled') then return public.get_bot_match_state(m.id); end if;

  if m.status='countdown' then
    if m.started_at>clock_timestamp() then return public.get_bot_match_state(m.id); end if;
    update public.bot_matches
    set status='active',updated_at=clock_timestamp()
    where id=m.id;
    m.status:='active';
  end if;

  if m.status='active'
    and m.bot_attempts_used<m.attempt_limit
    and m.bot_solved_at is null
    and m.bot_next_guess_at is not null
    and m.bot_next_guess_at<=clock_timestamp()
  then
    select answer_word,answer_version
    into secret,secret_version
    from public.bot_match_secrets
    where match_id=m.id;

    next_attempt:=m.bot_attempts_used+1;

    select
      coalesce(max(coalesce((g.feedback->>'green')::integer,0)),0),
      coalesce(max(
        coalesce((g.feedback->>'green')::integer,0)
        + coalesce((g.feedback->>'yellow')::integer,0)
      ),0)
    into max_green,max_present
    from public.bot_match_guesses g
    where g.match_id=m.id and g.actor='bot';

    select count(*)::integer
    into candidate_count
    from public.multiplayer_answer_words aw
    where aw.answer_version=secret_version
      and aw.enabled=true
      and aw.length=m.word_length
      and not exists(
        select 1
        from public.bot_match_guesses prior
        where prior.match_id=m.id
          and prior.actor='bot'
          and (
            case
              when m.mode='classic' then
                (public.live_feedback(prior.guess_word,aw.word)->'pattern')
                  is distinct from (prior.feedback->'pattern')
              else
                coalesce((public.live_feedback(prior.guess_word,aw.word)->>'green')::integer,0)
                  <> coalesce((prior.feedback->>'green')::integer,0)
                or coalesce((public.live_feedback(prior.guess_word,aw.word)->>'yellow')::integer,0)
                  <> coalesce((prior.feedback->>'yellow')::integer,0)
                or coalesce((public.live_feedback(prior.guess_word,aw.word)->>'red')::integer,0)
                  <> coalesce((prior.feedback->>'red')::integer,0)
            end
          )
      );

    if lower(m.bot_key)='efe' then
      solve_floor:=greatest(3,m.word_length-1);
      candidate_cap:=1;
    elsif lower(m.bot_key)='atlas' then
      solve_floor:=greatest(3,m.word_length-2);
      candidate_cap:=3;
    else
      solve_floor:=greatest(3,m.word_length-1);
      candidate_cap:=2;
    end if;

    solve_ready:=m.bot_target_attempt<=m.attempt_limit
      and next_attempt>=m.bot_target_attempt
      and max_present>=solve_floor
      and candidate_count between 1 and candidate_cap;

    if solve_ready then
      -- The bot chooses only among answers that are logically consistent with
      -- all feedback it has seen. The secret itself is never read as the guess.
      select aw.word into guess
      from public.multiplayer_answer_words aw
      where aw.answer_version=secret_version
        and aw.enabled=true
        and aw.length=m.word_length
        and not exists(
          select 1
          from public.bot_match_guesses prior
          where prior.match_id=m.id
            and prior.actor='bot'
            and (
              case
                when m.mode='classic' then
                  (public.live_feedback(prior.guess_word,aw.word)->'pattern')
                    is distinct from (prior.feedback->'pattern')
                else
                  coalesce((public.live_feedback(prior.guess_word,aw.word)->>'green')::integer,0)
                    <> coalesce((prior.feedback->>'green')::integer,0)
                  or coalesce((public.live_feedback(prior.guess_word,aw.word)->>'yellow')::integer,0)
                    <> coalesce((prior.feedback->>'yellow')::integer,0)
                  or coalesce((public.live_feedback(prior.guess_word,aw.word)->>'red')::integer,0)
                    <> coalesce((prior.feedback->>'red')::integer,0)
              end
            )
        )
      order by random()
      limit 1;
    else
      guess:=public.pick_bot_decoy(m.id,secret,m.word_length,m.bot_key);
    end if;

    /*
     * No fair unused probe remains. Do not freeze the match and do not reveal
     * the secret. The bot simply exhausts its remaining attempts. The human can
     * keep playing; if the human is also out of attempts, the match is a draw.
     */
    if guess is null then
      update public.bot_matches
      set bot_attempts_used=attempt_limit,
          bot_next_guess_at=null,
          updated_at=clock_timestamp()
      where id=m.id;

      if m.player_attempts_used>=m.attempt_limit and m.player_solved_at is null then
        update public.bot_matches
        set status='ended',winner_kind='draw',end_reason='draw',
            ended_at=clock_timestamp(),updated_at=clock_timestamp()
        where id=m.id;
        perform public.record_bot_match_stats(m.id);
      end if;

      return public.get_bot_match_state(m.id);
    end if;

    fb:=public.live_feedback(guess,secret);
    solved:=guess=secret;
    public_fb:=case when m.mode='classic' then fb else fb-'pattern' end;

    insert into public.bot_match_guesses(
      match_id,actor,guess_no,guess_word,feedback,solved
    ) values(
      m.id,'bot',next_attempt,guess,public_fb,solved
    );

    update public.bot_matches
    set bot_attempts_used=next_attempt,
        bot_solved_at=case when solved then clock_timestamp() else bot_solved_at end,
        bot_next_guess_at=case
          when solved or next_attempt>=attempt_limit then null
          else clock_timestamp()+make_interval(secs=>public.bot_delay_seconds(bot_key))
        end,
        updated_at=clock_timestamp()
    where id=m.id;

    if solved then
      update public.bot_matches
      set status='ended',winner_kind='bot',end_reason='solved',
          ended_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=m.id;
      perform public.record_bot_match_stats(m.id);
    elsif next_attempt>=m.attempt_limit
      and m.player_attempts_used>=m.attempt_limit
      and m.player_solved_at is null
    then
      update public.bot_matches
      set status='ended',winner_kind='draw',end_reason='draw',
          ended_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=m.id;
      perform public.record_bot_match_stats(m.id);
    end if;
  end if;

  return public.get_bot_match_state(m.id);
end;
$$;

create or replace function public.create_live_match(p_mode text, p_word_length integer)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  uid uuid:=auth.uid();
  selected_mode text:=lower(coalesce(p_mode,''));
  selected_length integer:=p_word_length;
  attempts integer;
  room text;
  answer text;
  new_id uuid;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  if not exists(select 1 from public.profiles where id=uid) then raise exception 'Önce profil oluştur'; end if;
  if selected_mode not in ('kelimelik','classic') or selected_length not in (4,5,6) then raise exception 'Geçersiz oyun modu'; end if;

  attempts:=case when selected_mode='classic' then selected_length+1 else 8 end;
  answer:=public.pick_fresh_multiplayer_answer(selected_length,array[uid]::uuid[],null);
  room:=public.make_live_room_code();

  insert into public.live_matches(room_code,mode,word_length,attempt_limit,host_id)
  values(room,selected_mode,selected_length,attempts,uid)
  returning id into new_id;

  insert into public.live_match_secrets(match_id,answer_version,answer_word)
  values(new_id,'A3',answer);

  insert into public.live_match_players(match_id,player_id,seat)
  values(new_id,uid,1);

  return public.get_live_match_state(new_id);
end;
$$;

create or replace function public.enter_quick_match(p_mode text, p_length integer)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  uid uuid:=auth.uid();
  clean_mode text:=lower(btrim(coalesce(p_mode,'')));
  clean_length integer:=p_length;
  attempts integer;
  my_score numeric:=0;
  mine public.quick_match_queue%rowtype;
  candidate public.quick_match_queue%rowtype;
  existing_match public.live_matches%rowtype;
  new_match_id uuid:=gen_random_uuid();
  room_code text;
  secret text;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  if not exists(select 1 from public.profiles where id=uid) then raise exception 'Önce oyuncu profili oluştur'; end if;
  if clean_mode not in ('classic','kelimelik') or clean_length not in (4,5,6) then raise exception 'Geçersiz oyun modu'; end if;

  attempts:=case when clean_mode='classic' then clean_length+1 else 8 end;
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

  insert into public.quick_match_queue as ownq(
    player_id,mode,word_length,performance_score,status,match_id,joined_at,last_seen_at,updated_at
  ) values(
    uid,clean_mode,clean_length,my_score,'waiting',null,clock_timestamp(),clock_timestamp(),clock_timestamp()
  )
  on conflict (player_id) do update set
    mode=excluded.mode,
    word_length=excluded.word_length,
    performance_score=excluded.performance_score,
    status='waiting',
    match_id=null,
    joined_at=case
      when ownq.status='waiting' and ownq.mode=excluded.mode and ownq.word_length=excluded.word_length
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
    secret:=public.pick_fresh_multiplayer_answer(
      clean_length,
      array[candidate.player_id,uid]::uuid[],
      null
    );

    room_code:=public.make_live_room_code();
    insert into public.live_matches(
      id,room_code,mode,word_length,attempt_limit,host_id,guest_id,status,started_at,match_kind
    ) values(
      new_match_id,room_code,clean_mode,clean_length,attempts,
      candidate.player_id,uid,'countdown',clock_timestamp()+interval '4 seconds','quick'
    );

    insert into public.live_match_secrets(match_id,answer_version,answer_word)
    values(new_match_id,'A3',secret);

    insert into public.live_match_players(match_id,player_id,seat)
    values(new_match_id,candidate.player_id,1),(new_match_id,uid,2);

    update public.quick_match_queue
    set status='matched',match_id=new_match_id,last_seen_at=clock_timestamp(),updated_at=clock_timestamp()
    where player_id in (uid,candidate.player_id);

    return jsonb_build_object(
      'status','matched',
      'match',public.get_live_match_state(new_match_id),
      'serverNow',clock_timestamp()
    );
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

  select * into m
  from public.live_matches
  where id=p_match_id
  for update;

  if not found or uid not in (m.host_id,m.guest_id) then raise exception 'Maça erişim yok'; end if;
  if m.status<>'ended' or m.guest_id is null then raise exception 'Rövanş şu anda kullanılamıyor'; end if;
  if m.rematch_match_id is not null then return public.get_live_match_state(m.rematch_match_id); end if;

  if m.rematch_requested_by is null then
    update public.live_matches
    set rematch_requested_by=uid,updated_at=clock_timestamp()
    where id=m.id;
    return public.get_live_match_state(m.id);
  end if;

  if m.rematch_requested_by=uid then return public.get_live_match_state(m.id); end if;

  select answer_word into old_secret
  from public.live_match_secrets
  where match_id=m.id;

  new_secret:=public.pick_fresh_multiplayer_answer(
    m.word_length,
    array[m.host_id,m.guest_id]::uuid[],
    old_secret
  );
  new_code:=public.make_live_room_code();

  insert into public.live_matches(
    id,room_code,mode,word_length,attempt_limit,host_id,guest_id,status,
    started_at,parent_match_id,match_kind
  ) values(
    new_id,new_code,m.mode,m.word_length,m.attempt_limit,m.host_id,m.guest_id,
    'countdown',clock_timestamp()+interval '4 seconds',m.id,m.match_kind
  );

  insert into public.live_match_secrets(match_id,answer_version,answer_word)
  values(new_id,'A3',new_secret);

  insert into public.live_match_players(match_id,player_id,seat)
  values(new_id,m.host_id,1),(new_id,m.guest_id,2);

  update public.live_matches
  set rematch_match_id=new_id,rematch_requested_by=null,updated_at=clock_timestamp()
  where id=m.id;

  return public.get_live_match_state(new_id);
end;
$$;
