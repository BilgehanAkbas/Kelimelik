-- Online maç sonuçlarında gizli cevabı yalnız maç bittikten sonra gösterir.
-- Online geçmiş kayıtlarına çözme/maç süresini ekler.

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
  answer text := null;
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

  if m.status in ('ended','cancelled') then
    select s.answer_word into answer
    from public.live_match_secrets s
    where s.match_id=m.id;
  end if;

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
    'answerWord',answer,
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
  answer text := null;
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

  if m.status in ('ended','cancelled') then
    select s.answer_word into answer
    from public.bot_match_secrets s
    where s.match_id=m.id;
  end if;

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
    'answerWord',answer,
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

create or replace function public.get_my_recent_match_history(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_limit integer := least(100, greatest(1, coalesce(p_limit, 50)));
  result jsonb;
begin
  if uid is null then
    raise exception 'Oturum gerekli';
  end if;

  with live_rows as (
    select
      m.id::text as id,
      'online'::text as source,
      m.match_kind::text as match_kind,
      m.mode::text as mode,
      m.word_length::integer as word_length,
      m.attempt_limit::integer as attempt_limit,
      s.answer_word::text as answer_word,
      case
        when m.winner_id = uid then 'win'
        when m.winner_id is null and m.end_reason = 'draw' then 'draw'
        else 'loss'
      end::text as result_kind,
      me.attempts_used::integer as attempts_used,
      greatest(0,floor(extract(epoch from (
        coalesce(me.solved_at,m.ended_at,m.updated_at,m.created_at)-coalesce(m.started_at,m.created_at)
      )))::integer) as duration_seconds,
      coalesce(m.ended_at, m.updated_at, m.created_at) as ended_at,
      opp.nickname::text as opponent_nickname,
      opp.player_code::text as opponent_code
    from public.live_matches m
    join public.live_match_secrets s on s.match_id = m.id
    join public.live_match_players me
      on me.match_id = m.id and me.player_id = uid
    left join public.profiles opp
      on opp.id = case when m.host_id = uid then m.guest_id else m.host_id end
    where m.status = 'ended'
      and uid in (m.host_id, m.guest_id)
  ),
  bot_rows as (
    select
      m.id::text as id,
      'online'::text as source,
      'bot'::text as match_kind,
      m.mode::text as mode,
      m.word_length::integer as word_length,
      m.attempt_limit::integer as attempt_limit,
      s.answer_word::text as answer_word,
      case
        when m.winner_kind = 'human' then 'win'
        when m.winner_kind = 'draw' then 'draw'
        else 'loss'
      end::text as result_kind,
      m.player_attempts_used::integer as attempts_used,
      greatest(0,floor(extract(epoch from (
        coalesce(m.player_solved_at,m.ended_at,m.updated_at,m.created_at)-coalesce(m.started_at,m.created_at)
      )))::integer) as duration_seconds,
      coalesce(m.ended_at, m.updated_at, m.created_at) as ended_at,
      public.bot_name(m.bot_key)::text as opponent_nickname,
      'BOT'::text as opponent_code
    from public.bot_matches m
    join public.bot_match_secrets s on s.match_id = m.id
    where m.status = 'ended'
      and m.player_id = uid
  ),
  combined as (
    select * from live_rows
    union all
    select * from bot_rows
  ),
  limited as (
    select *
    from combined
    order by ended_at desc
    limit clean_limit
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',id,
        'source',source,
        'matchKind',match_kind,
        'mode',mode,
        'wordLength',word_length,
        'attemptLimit',attempt_limit,
        'answerWord',answer_word,
        'result',result_kind,
        'won',result_kind='win',
        'draw',result_kind='draw',
        'attemptsUsed',attempts_used,
        'durationSeconds',duration_seconds,
        'endedAt',ended_at,
        'opponentNickname',opponent_nickname,
        'opponentCode',opponent_code
      )
      order by ended_at desc
    ),
    '[]'::jsonb
  ) into result
  from limited;

  return result;
end;
$$;
