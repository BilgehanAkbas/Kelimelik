-- Kelimelik v1.2.25 — progressive bot guesses + coherent deduction
-- 2026-08-16
--
-- Bot tahminleri artık önceki bot geri bildirimleriyle çelişen kelimelere geri dönmez.
-- Klasik modda tüm önceki renk desenleri, Kelimelik modunda tüm önceki sayaçlar
-- aday cevapla yeniden üretilebilmelidir. Ayrıca botun yeni tahminindeki yeşil ve
-- toplam mevcut-harf sayısı önceki en iyi seviyenin altına düşmez.

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
  latest_guess text;
begin
  select m.mode into match_mode
  from public.bot_matches m
  where m.id=p_match_id;

  select
    coalesce(max(coalesce((g.feedback->>'green')::integer,0)),0),
    coalesce(max(
      coalesce((g.feedback->>'green')::integer,0)
      + coalesce((g.feedback->>'yellow')::integer,0)
    ),0)
  into max_green,max_present
  from public.bot_match_guesses g
  where g.match_id=p_match_id and g.actor='bot';

  /*
   * Önce dengeli A1 cevap havuzundan, önceki bütün geri bildirimlerle uyumlu
   * ve ilerlemeyi geriye götürmeyen doğal bir tahmin seç.
   */
  select w.word into chosen
  from public.multiplayer_answer_words w
  where w.answer_version='A1'
    and w.enabled=true
    and w.length=p_length
    and w.word<>p_answer
    and not exists(
      select 1
      from public.bot_match_guesses used
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
              (public.live_feedback(prior.guess_word,w.word)->'pattern')
                is distinct from (prior.feedback->'pattern')
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
      * case lower(p_bot_key) when 'atlas' then 6 when 'defne' then 5 else 4 end
    + coalesce((public.live_feedback(w.word,p_answer)->>'yellow')::integer,0)
      * case lower(p_bot_key) when 'atlas' then 2.5 when 'defne' then 2 else 1.5 end
    + random()*case lower(p_bot_key) when 'atlas' then 0.7 when 'defne' then 1.8 else 4.0 end
  ) desc
  limit 1;

  /*
   * A1 havuzu çok daraldıysa geniş tahmin havuzuna geç. Aynı tutarlılık ve
   * ilerleme kuralları burada da geçerlidir.
   */
  if chosen is null then
    select w.word into chosen
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
                (public.live_feedback(prior.guess_word,w.word)->'pattern')
                  is distinct from (prior.feedback->'pattern')
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
        * case lower(p_bot_key) when 'atlas' then 6 when 'defne' then 5 else 4 end
      + coalesce((public.live_feedback(w.word,p_answer)->>'yellow')::integer,0)
        * case lower(p_bot_key) when 'atlas' then 2.5 when 'defne' then 2 else 1.5 end
      + random()*case lower(p_bot_key) when 'atlas' then 0.7 when 'defne' then 1.8 else 4.0 end
    ) desc
    limit 1;
  end if;

  /*
   * Çok uç bir durumda yeni tutarlı decoy kalmazsa rastgele kötü bir kelimeye
   * düşmek yerine son tahmini koru. Böylece bot kazanılmış bilgiyi unutmaz.
   */
  if chosen is null then
    select g.guess_word into latest_guess
    from public.bot_match_guesses g
    where g.match_id=p_match_id and g.actor='bot'
    order by g.guess_no desc
    limit 1;
    chosen:=latest_guess;
  end if;

  return chosen;
end;
$$;

revoke all on function public.pick_bot_decoy(uuid,text,integer,text) from public, anon, authenticated;
