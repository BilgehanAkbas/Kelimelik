-- Kelimelik v1.2.37 — bot accuracy progression
-- Efe starts from 0 known/present letters and progresses gradually.
-- Defne starts from 1 known/present letter and progresses gradually.
-- Previous-feedback consistency and no-repeat rules remain intact.

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
  max_green integer := 0;
  max_present integer := 0;
  bot_attempt_no integer := 1;
  target_present integer := null;
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

  if lower(p_bot_key)='efe' then
    target_present:=least(p_length-1,greatest(max_present,bot_attempt_no-1));
  elsif lower(p_bot_key)='defne' then
    target_present:=least(p_length-1,greatest(max_present,bot_attempt_no));
  end if;

  select w.word into chosen
  from public.multiplayer_answer_words w
  where w.answer_version='A3'
    and w.enabled=true
    and w.length=p_length
    and w.word<>p_answer
    and not exists(
      select 1 from public.bot_match_guesses used
      where used.match_id=p_match_id
        and used.actor='bot'
        and used.guess_word=w.word
    )
    and coalesce((public.live_feedback(w.word,p_answer)->>'green')::integer,0) >= max_green
    and (
      target_present is null
      or coalesce((public.live_feedback(w.word,p_answer)->>'green')::integer,0)
         + coalesce((public.live_feedback(w.word,p_answer)->>'yellow')::integer,0) = target_present
    )
    and not exists(
      select 1
      from public.bot_match_guesses prior
      where prior.match_id=p_match_id
        and prior.actor='bot'
        and (
          case
            when match_mode='classic' then
              (public.live_feedback(prior.guess_word,w.word)->'pattern') is distinct from (prior.feedback->'pattern')
            else
              coalesce((public.live_feedback(prior.guess_word,w.word)->>'green')::integer,0)
                <> coalesce((prior.feedback->>'green')::integer,0)
              or coalesce((public.live_feedback(prior.guess_word,w.word)->>'yellow')::integer,0)
                <> coalesce((prior.feedback->>'yellow')::integer,0)
              or coalesce((public.live_feedback(prior.guess_word,w.word)->>'red')::integer,0)
                <> coalesce((prior.feedback->>'red')::integer,0)
          end
        )
    )
  order by random()
  limit 1;

  if chosen is null then
    select w.word into chosen
    from public.multiplayer_guess_words w
    where w.length=p_length
      and w.word<>p_answer
      and not exists(
        select 1 from public.bot_match_guesses used
        where used.match_id=p_match_id
          and used.actor='bot'
          and used.guess_word=w.word
      )
      and coalesce((public.live_feedback(w.word,p_answer)->>'green')::integer,0) >= max_green
      and (
        target_present is null
        or coalesce((public.live_feedback(w.word,p_answer)->>'green')::integer,0)
           + coalesce((public.live_feedback(w.word,p_answer)->>'yellow')::integer,0) = target_present
      )
      and not exists(
        select 1
        from public.bot_match_guesses prior
        where prior.match_id=p_match_id
          and prior.actor='bot'
          and (
            case
              when match_mode='classic' then
                (public.live_feedback(prior.guess_word,w.word)->'pattern') is distinct from (prior.feedback->'pattern')
              else
                coalesce((public.live_feedback(prior.guess_word,w.word)->>'green')::integer,0)
                  <> coalesce((prior.feedback->>'green')::integer,0)
                or coalesce((public.live_feedback(prior.guess_word,w.word)->>'yellow')::integer,0)
                  <> coalesce((prior.feedback->>'yellow')::integer,0)
                or coalesce((public.live_feedback(prior.guess_word,w.word)->>'red')::integer,0)
                  <> coalesce((prior.feedback->>'red')::integer,0)
            end
          )
      )
    order by random()
    limit 1;
  end if;

  /* If an exact progression target is exhausted, keep deduction coherent and
     choose the least informative still-valid candidate before random fallback. */
  if chosen is null then
    select w.word into chosen
    from public.multiplayer_guess_words w
    where w.length=p_length
      and w.word<>p_answer
      and not exists(
        select 1 from public.bot_match_guesses used
        where used.match_id=p_match_id
          and used.actor='bot'
          and used.guess_word=w.word
      )
      and coalesce((public.live_feedback(w.word,p_answer)->>'green')::integer,0) >= max_green
      and (
        coalesce((public.live_feedback(w.word,p_answer)->>'green')::integer,0)
        + coalesce((public.live_feedback(w.word,p_answer)->>'yellow')::integer,0)
      ) >= max_present
      and not exists(
        select 1
        from public.bot_match_guesses prior
        where prior.match_id=p_match_id
          and prior.actor='bot'
          and (
            case
              when match_mode='classic' then
                (public.live_feedback(prior.guess_word,w.word)->'pattern') is distinct from (prior.feedback->'pattern')
              else
                coalesce((public.live_feedback(prior.guess_word,w.word)->>'green')::integer,0)
                  <> coalesce((prior.feedback->>'green')::integer,0)
                or coalesce((public.live_feedback(prior.guess_word,w.word)->>'yellow')::integer,0)
                  <> coalesce((prior.feedback->>'yellow')::integer,0)
                or coalesce((public.live_feedback(prior.guess_word,w.word)->>'red')::integer,0)
                  <> coalesce((prior.feedback->>'red')::integer,0)
            end
          )
      )
    order by (
      coalesce((public.live_feedback(w.word,p_answer)->>'green')::integer,0)
      + coalesce((public.live_feedback(w.word,p_answer)->>'yellow')::integer,0)
    ) asc, random()
    limit 1;
  end if;

  if chosen is null then
    select w.word into chosen
    from public.multiplayer_guess_words w
    where w.length=p_length
      and w.word<>p_answer
      and not exists(
        select 1 from public.bot_match_guesses used
        where used.match_id=p_match_id
          and used.actor='bot'
          and used.guess_word=w.word
      )
    order by random()
    limit 1;
  end if;

  if chosen is null then
    raise exception 'Bot için yeni tahmin bulunamadı';
  end if;

  return chosen;
end;
$$;

revoke all on function public.pick_bot_decoy(uuid,text,integer,text) from public, anon, authenticated;
