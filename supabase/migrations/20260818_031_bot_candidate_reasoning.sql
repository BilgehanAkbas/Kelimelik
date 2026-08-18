-- Kelimelik — final bot candidate reasoning
-- Bots no longer submit the known secret just because a target turn arrived.
-- They may attempt a solution only from the answer candidates that remain
-- consistent with all feedback they have actually received.

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
  secret_version text := 'A3';
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
    secret_version:='A1';
    select aw.word into secret
    from public.multiplayer_answer_words aw
    where aw.answer_version='A1' and aw.length=clean_length and aw.enabled
    order by random()
    limit 1;
  end if;

  if secret is null then raise exception 'Online cevap havuzu yüklenmemiş'; end if;

  -- Difficulty is driven by failure chance, target turn and information curve.
  if clean_bot='efe' then
    if fail_roll<0.45 then
      target:=attempts+1;
    else
      target_low:=greatest(4,attempts-2);
      target_high:=attempts;
    end if;
  elsif clean_bot='defne' then
    if fail_roll<0.20 then
      target:=attempts+1;
    else
      target_low:=greatest(4,attempts-3);
      target_high:=least(attempts,7);
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
  values(match_id,secret_version,secret);

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

    /*
     * Count only answer candidates that fit every feedback result the bot has
     * actually seen. This is the bot's logical remaining candidate set.
     */
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

    /*
     * Efe is the cautious/weak bot: it only commits when one answer remains.
     * Defne is medium: near-complete visible info and at most two candidates.
     * Atlas is strong: it can take a reasoned chance among at most three
     * candidates, but still cannot jump from very low information to the answer.
     */
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
      /* Pick from what the bot can logically still believe, not from secret. */
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

    /* No fair unused probe remains: the bot stops instead of cheating. */
    if guess is null then
      update public.bot_matches
      set bot_next_guess_at=null,
          updated_at=clock_timestamp()
      where id=m.id;
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
