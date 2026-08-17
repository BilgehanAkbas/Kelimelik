-- Bot tahminlerinde tekrar engeli.
-- Önceki sürümlerde sıkı aday havuzu tükenirse son tahmin yeniden kullanılabiliyordu.
-- Bu sürümde önceki bot tahminleri her fallback aşamasında dışlanır.

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
  defne_green_cap integer := null;
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

  if lower(p_bot_key)='defne' then
    if bot_attempt_no=1 then
      defne_green_cap:=case p_length when 4 then 1 when 5 then 2 else 2 end;
    elsif bot_attempt_no=2 then
      defne_green_cap:=case p_length when 4 then 2 when 5 then 3 else 3 end;
    end if;
  end if;

  -- 1) A1 havuzunda tamamen tutarlı, kullanılmamış aday.
  select w.word into chosen
  from public.multiplayer_answer_words w
  where w.answer_version='A1'
    and w.enabled=true
    and w.length=p_length
    and w.word<>p_answer
    and not exists(
      select 1 from public.bot_match_guesses used
      where used.match_id=p_match_id and used.actor='bot' and used.guess_word=w.word
    )
    and coalesce((public.live_feedback(w.word,p_answer)->>'green')::integer,0) >= max_green
    and (defne_green_cap is null or coalesce((public.live_feedback(w.word,p_answer)->>'green')::integer,0) <= defne_green_cap)
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
      * case lower(p_bot_key) when 'atlas' then 6 when 'defne' then 3.4 else 4 end
    + coalesce((public.live_feedback(w.word,p_answer)->>'yellow')::integer,0)
      * case lower(p_bot_key) when 'atlas' then 2.5 when 'defne' then 1.5 else 1.5 end
    + random()*case lower(p_bot_key) when 'atlas' then 0.7 when 'defne' then 3.2 else 4.0 end
  ) desc
  limit 1;

  -- 2) Geniş tahmin havuzunda tamamen tutarlı, kullanılmamış aday.
  if chosen is null then
    select w.word into chosen
    from public.multiplayer_guess_words w
    where w.length=p_length
      and w.word<>p_answer
      and not exists(
        select 1 from public.bot_match_guesses used
        where used.match_id=p_match_id and used.actor='bot' and used.guess_word=w.word
      )
      and coalesce((public.live_feedback(w.word,p_answer)->>'green')::integer,0) >= max_green
      and (defne_green_cap is null or coalesce((public.live_feedback(w.word,p_answer)->>'green')::integer,0) <= defne_green_cap)
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
        * case lower(p_bot_key) when 'atlas' then 6 when 'defne' then 3.4 else 4 end
      + coalesce((public.live_feedback(w.word,p_answer)->>'yellow')::integer,0)
        * case lower(p_bot_key) when 'atlas' then 2.5 when 'defne' then 1.5 else 1.5 end
      + random()*case lower(p_bot_key) when 'atlas' then 0.7 when 'defne' then 3.2 else 4.0 end
    ) desc
    limit 1;
  end if;

  -- 3) Tutarlılık çok daraltmışsa önce ilerleme seviyesini koruyarak gevşet.
  --    Kullanılmış kelimeler yine kesin olarak dışarıda kalır.
  if chosen is null then
    select w.word into chosen
    from public.multiplayer_guess_words w
    where w.length=p_length
      and w.word<>p_answer
      and not exists(
        select 1 from public.bot_match_guesses used
        where used.match_id=p_match_id and used.actor='bot' and used.guess_word=w.word
      )
      and coalesce((public.live_feedback(w.word,p_answer)->>'green')::integer,0) >= max_green
      and (
        coalesce((public.live_feedback(w.word,p_answer)->>'green')::integer,0)
        + coalesce((public.live_feedback(w.word,p_answer)->>'yellow')::integer,0)
      ) >= max_present
    order by (
      coalesce((public.live_feedback(w.word,p_answer)->>'green')::integer,0) * 5
      + coalesce((public.live_feedback(w.word,p_answer)->>'yellow')::integer,0) * 2
      + random()
    ) desc
    limit 1;
  end if;

  -- 4) Son güvenlik ağı: herhangi bir farklı, geçerli ve daha önce kullanılmamış
  --    kelime. Havuz binlerce kelime olduğu için normal maçta buraya nadiren gelir.
  if chosen is null then
    select w.word into chosen
    from public.multiplayer_guess_words w
    where w.length=p_length
      and w.word<>p_answer
      and not exists(
        select 1 from public.bot_match_guesses used
        where used.match_id=p_match_id and used.actor='bot' and used.guess_word=w.word
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
