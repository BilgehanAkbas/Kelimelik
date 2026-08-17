-- Kelimelik v1.2.23 — Online maç geçmişi
-- 2026-08-16
--
-- Profil > Kelime Geçmişi ekranının yalnızca localStorage'daki tek oyunculu
-- oyunları değil, kullanıcının tamamlanmış canlı/bot maçlarını da güvenli
-- biçimde gösterebilmesi için son maçları döndüren bir RPC ekler.
-- Gizli cevaplar yalnızca maç bittikten sonra ve yalnız o maça katılan
-- kullanıcının kendi geçmişi içinde açılır.

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

revoke all on function public.get_my_recent_match_history(integer) from public, anon;
grant execute on function public.get_my_recent_match_history(integer) to authenticated;
