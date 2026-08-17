-- Kelimelik v1.2.26 — Defne early-game nerf
-- 2026-08-16
--
-- Defne orta seviye bot olarak kalır, ancak özellikle 4 harfli oyunlarda
-- ilk tahminde cevabın 3 harfini doğrudan doğru yere oturtma ihtimali
-- yapay biçimde yüksek olmasın. İlk tahmindeki yeşil sayısı sınırlandırılır
-- ve çözüm hedefi biraz daha geçe alınır. Önceki tutarlılık/progresif çıkarım
-- kuralları aynen korunur.

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
  fail_roll double precision := random();
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

  -- Efe zayıf, Defne orta, Atlas güçlü. Defne v1.2.26'da hafifçe nerflendi.
  if (clean_bot='efe' and fail_roll<0.28)
     or (clean_bot='defne' and fail_roll<0.20)
     or (clean_bot='atlas' and fail_roll<0.08)
  then
    target:=attempts+1;
  else
    target:=case clean_bot
      when 'atlas' then 2+floor(random()*greatest(1,least(attempts-1,4)))::integer
      -- Defne artık ikinci tahminde garantili çözüm temposuna düşmez; en erken 3.
      when 'defne' then 3+floor(random()*greatest(1,attempts-2))::integer
      else 2+floor(random()*greatest(1,attempts-1))::integer
    end;
    target:=least(target,attempts);
  end if;

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

revoke all on function public.create_bot_match(text,integer,text) from public, anon;
grant execute on function public.create_bot_match(text,integer,text) to authenticated;

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

  -- Defne'nin erken oyunda aşırı bilgiyle başlamasını önle.
  -- 4 harf: ilk tahmin en fazla 1 yeşil, ikinci tahmin en fazla 2 yeşil.
  -- 5/6 harflerde sınır doğal olarak biraz daha geniş tutulur.
  if lower(p_bot_key)='defne' then
    if bot_attempt_no=1 then
      defne_green_cap:=case p_length when 4 then 1 when 5 then 2 else 2 end;
    elsif bot_attempt_no=2 then
      defne_green_cap:=case p_length when 4 then 2 when 5 then 3 else 3 end;
    end if;
  end if;

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

  -- Sınır nedeniyle aday kalmadıysa Defne rastgele güçlü adaya sıçramasın;
  -- son tutarlı seviyesini korusun.
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
