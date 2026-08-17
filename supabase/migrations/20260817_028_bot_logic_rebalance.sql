-- Kelimelik — bot reasoning rebalance
-- Efe / Defne / Atlas now have distinct learning curves.
-- Bot feedback knowledge (green and green+yellow) never regresses.
-- Unsafe random fallback is removed; if no safe decoy exists, the bot solves early.

create or replace function public.bot_delay_seconds(p_bot_key text)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
begin
  return case lower(p_bot_key)
    when 'efe' then 5 + floor(random()*5)::integer       -- 5..9 sn
    when 'atlas' then 9 + floor(random()*7)::integer     -- 9..15 sn
    else 7 + floor(random()*6)::integer                  -- Defne: 7..12 sn
  end;
end;
$$;

create or replace function public.create_bot_match(
  p_mode text,
  p_length integer,
  p_bot_key text default null
)
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
  target_low integer;
  target_high integer;
  fail_roll double precision := random();
  start_time timestamptz := clock_timestamp()+interval '4 seconds';
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  if not exists(select 1 from public.profiles where id=uid) then
    raise exception 'Önce oyuncu profili oluştur';
  end if;

  if clean_mode='classic' and clean_length in (4,5,6) then
    attempts:=clean_length+1;
  elsif clean_mode='kelimelik' and clean_length in (4,5,6) then
    attempts:=8;
  else
    raise exception 'Geçersiz oyun modu';
  end if;

  if clean_bot not in ('efe','defne','atlas') then
    clean_bot:=(array['efe','defne','atlas'])[1+floor(random()*3)::integer];
  end if;

  select aw.word into secret
  from public.multiplayer_answer_words aw
  where aw.answer_version='A3' and aw.length=clean_length and aw.enabled
  order by random()
  limit 1;

  if secret is null then
    select aw.word into secret
    from public.multiplayer_answer_words aw
    where aw.answer_version='A1' and aw.length=clean_length and aw.enabled
    order by random()
    limit 1;
  end if;

  if secret is null then raise exception 'Online cevap havuzu yüklenmemiş'; end if;

  /*
   * Difficulty profile:
   * - Efe: weak; often needs the final turns and sometimes cannot solve.
   * - Defne: medium; usually solves in the middle/later turns.
   * - Atlas: strong; usually solves early, but still behaves like a human opponent.
   */
  if clean_bot='efe' then
    if fail_roll<0.45 then
      target:=attempts+1;
    else
      target_low:=greatest(4,attempts-2);
      target_high:=attempts;
    end if;
  elsif clean_bot='defne' then
    if fail_roll<0.15 then
      target:=attempts+1;
    else
      target_low:=greatest(3,attempts-4);
      target_high:=least(attempts,6);
    end if;
  else
    if fail_roll<0.04 then
      target:=attempts+1;
    else
      target_low:=2;
      target_high:=least(attempts,4);
    end if;
  end if;

  if target is null then
    target_high:=greatest(target_low,target_high);
    target:=target_low+floor(random()*(target_high-target_low+1))::integer;
    target:=least(target,attempts);
  end if;

  insert into public.bot_matches(
    id,player_id,mode,word_length,attempt_limit,bot_key,
    bot_target_attempt,status,started_at,bot_next_guess_at
  ) values(
    match_id,uid,clean_mode,clean_length,attempts,clean_bot,
    target,'countdown',start_time,
    start_time + make_interval(secs=>public.bot_delay_seconds(clean_bot))
  );

  insert into public.bot_match_secrets(match_id,answer_version,answer_word)
  values(match_id,'A3',secret);

  return public.get_bot_match_state(match_id);
end;
$$;

create or replace function public.pick_bot_decoy(
  p_match_id uuid,
  p_answer text,
  p_length integer,
  p_bot_key text
)
returns text
language plpgsql
security definer
volatile
set search_path = public, extensions, pg_temp
as $$
declare
  chosen text;
  match_mode text;
  bot_key text := lower(coalesce(p_bot_key,'defne'));
  max_green integer := 0;
  max_present integer := 0;
  bot_attempt_no integer := 1;
  target_present integer := 0;
  target_green integer := 0;
begin
  select m.mode into match_mode
  from public.bot_matches m
  where m.id=p_match_id;

  select
    coalesce(max(coalesce((g.feedback->>'green')::integer,0)),0),
    coalesce(max(
      coalesce((g.feedback->>'green')::integer,0)
      + coalesce((g.feedback->>'yellow')::integer,0)
    ),0),
    count(*)::integer + 1
  into max_green,max_present,bot_attempt_no
  from public.bot_match_guesses g
  where g.match_id=p_match_id and g.actor='bot';

  /* Visible information progression. It is always >= the best previous result. */
  target_present:=case bot_key
    when 'efe' then least(p_length-1,greatest(max_present,bot_attempt_no/2))
    when 'atlas' then least(p_length-1,greatest(max_present,bot_attempt_no+1))
    else least(p_length-1,greatest(max_present,bot_attempt_no))
  end;

  /* Position accuracy profile; never lower than the previous green maximum. */
  target_green:=case bot_key
    when 'efe' then max_green
    when 'atlas' then least(target_present,greatest(max_green,bot_attempt_no))
    else least(target_present,greatest(max_green,bot_attempt_no/2))
  end;

  /*
   * First choice: a still-possible secret according to every previous feedback.
   * This is the most human/logical path and keeps both green and total-present
   * knowledge monotonic.
   */
  with candidate_words as (
    select w.word,
           case when exists(
             select 1
             from public.multiplayer_answer_words aw
             where aw.answer_version='A3'
               and aw.enabled=true
               and aw.length=p_length
               and aw.word=w.word
           ) then 0 else 1 end as pool_rank
    from public.multiplayer_guess_words w
    where w.length=p_length
      and w.word<>p_answer
      and not exists(
        select 1
        from public.bot_match_guesses used
        where used.match_id=p_match_id
          and used.actor='bot'
          and used.guess_word=w.word
      )
  ), scored as (
    select c.word,c.pool_rank,
           coalesce((f.fb->>'green')::integer,0) as green_count,
           coalesce((f.fb->>'yellow')::integer,0) as yellow_count,
           coalesce((f.fb->>'green')::integer,0)
             + coalesce((f.fb->>'yellow')::integer,0) as present_count
    from candidate_words c
    cross join lateral (
      select public.live_feedback(c.word,p_answer) as fb
    ) f
  )
  select s.word into chosen
  from scored s
  where s.green_count>=max_green
    and s.present_count>=max_present
    and not exists(
      select 1
      from public.bot_match_guesses prior
      where prior.match_id=p_match_id
        and prior.actor='bot'
        and (
          case
            when match_mode='classic' then
              (public.live_feedback(prior.guess_word,s.word)->'pattern')
                is distinct from (prior.feedback->'pattern')
            else
              coalesce((public.live_feedback(prior.guess_word,s.word)->>'green')::integer,0)
                <> coalesce((prior.feedback->>'green')::integer,0)
              or coalesce((public.live_feedback(prior.guess_word,s.word)->>'yellow')::integer,0)
                <> coalesce((prior.feedback->>'yellow')::integer,0)
              or coalesce((public.live_feedback(prior.guess_word,s.word)->>'red')::integer,0)
                <> coalesce((prior.feedback->>'red')::integer,0)
          end
        )
    )
  order by
    abs(s.present_count-target_present),
    case when s.present_count>target_present then 1 else 0 end,
    abs(s.green_count-target_green),
    s.pool_rank,
    random()
  limit 1;

  /*
   * Information-probe fallback: a rational solver may test a word outside the
   * remaining-secret set. The hard floors are still mandatory, so the visible
   * knowledge can never go backwards. In Classic mode, already-green positions
   * are also preserved.
   */
  if chosen is null then
    with candidate_words as (
      select w.word,
             case when exists(
               select 1
               from public.multiplayer_answer_words aw
               where aw.answer_version='A3'
                 and aw.enabled=true
                 and aw.length=p_length
                 and aw.word=w.word
             ) then 0 else 1 end as pool_rank
      from public.multiplayer_guess_words w
      where w.length=p_length
        and w.word<>p_answer
        and not exists(
          select 1
          from public.bot_match_guesses used
          where used.match_id=p_match_id
            and used.actor='bot'
            and used.guess_word=w.word
        )
    ), scored as (
      select c.word,c.pool_rank,
             coalesce((f.fb->>'green')::integer,0) as green_count,
             coalesce((f.fb->>'yellow')::integer,0) as yellow_count,
             coalesce((f.fb->>'green')::integer,0)
               + coalesce((f.fb->>'yellow')::integer,0) as present_count
      from candidate_words c
      cross join lateral (
        select public.live_feedback(c.word,p_answer) as fb
      ) f
    )
    select s.word into chosen
    from scored s
    where s.green_count>=max_green
      and s.present_count>=max_present
      and (
        match_mode<>'classic'
        or not exists(
          select 1
          from public.bot_match_guesses prior
          cross join lateral jsonb_array_elements_text(prior.feedback->'pattern')
            with ordinality as known(state,pos)
          where prior.match_id=p_match_id
            and prior.actor='bot'
            and known.state='green'
            and substring(s.word from known.pos::integer for 1)
                <> substring(prior.guess_word from known.pos::integer for 1)
        )
      )
    order by
      abs(s.present_count-target_present),
      case when s.present_count>target_present then 1 else 0 end,
      abs(s.green_count-target_green),
      s.pool_rank,
      random()
    limit 1;
  end if;

  /* Never forget learned information just to keep the match alive. */
  if chosen is null then
    chosen:=p_answer;
  end if;

  return chosen;
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
    select answer_word into secret
    from public.bot_match_secrets
    where match_id=m.id;

    next_attempt:=m.bot_attempts_used+1;

    if next_attempt=m.bot_target_attempt and m.bot_target_attempt<=m.attempt_limit then
      guess:=secret;
    else
      guess:=public.pick_bot_decoy(m.id,secret,m.word_length,m.bot_key);
    end if;

    /* Safe emergency: solving early is preferable to an irrational regression. */
    if guess is null then guess:=secret; end if;

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

revoke all on function public.pick_bot_decoy(uuid,text,integer,text) from public, anon, authenticated;
revoke all on function public.bot_delay_seconds(text) from public, anon, authenticated;
