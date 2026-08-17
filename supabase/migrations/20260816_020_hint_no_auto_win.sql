-- Kelimelik — hint must never submit the secret answer automatically.
-- The hint still respects prior count feedback and the best green floor whenever possible.

create or replace function public.use_custom_puzzle_hint(p_puzzle_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  code text := upper(btrim(coalesce(p_puzzle_code,'')));
  p public.custom_puzzles%rowtype;
  play public.custom_puzzle_plays%rowtype;
  secret text;
  hint text;
  best_green integer := 0;
  fb jsonb;
  public_fb jsonb;
  next_attempt integer;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;

  select * into p from public.custom_puzzles where puzzle_code=code and enabled for update;
  if not found then raise exception 'Özel bulmaca bulunamadı'; end if;
  if p.mode<>'kelimelik' then raise exception 'Klasik Modda ipucu kullanılmaz'; end if;

  select * into play
  from public.custom_puzzle_plays
  where puzzle_id=p.id and player_id=uid
  for update;
  if not found then raise exception 'Önce bulmacayı aç'; end if;
  if play.status='ended' then return public.get_custom_puzzle_state(code); end if;
  if play.hint_used then raise exception 'Bu bulmacada ipucunu zaten kullandın'; end if;
  if play.attempts_used<1 then raise exception 'İpucu için önce en az bir tahmin gönder'; end if;
  if play.attempts_used>=p.attempt_limit then return public.get_custom_puzzle_state(code); end if;

  select s.answer_word into secret
  from public.custom_puzzle_secrets s
  where s.puzzle_id=p.id;
  if secret is null then raise exception 'Gizli cevap bulunamadı'; end if;

  select coalesce(max((g.feedback->>'green')::integer),0)
  into best_green
  from public.custom_puzzle_guesses g
  where g.play_id=play.id;

  -- 1) Önce önceki tüm sayaçlarla tutarlı olası cevaplardan, gizli cevap hariç, seç.
  select aw.word into hint
  from public.multiplayer_answer_words aw
  where aw.answer_version='A1'
    and aw.length=p.word_length
    and aw.enabled
    and aw.word<>secret
    and not exists(
      select 1 from public.custom_puzzle_guesses pg
      where pg.play_id=play.id and pg.guess_word=aw.word
    )
    and (public.live_feedback(aw.word,secret)->>'green')::integer>=best_green
    and not exists(
      select 1
      from public.custom_puzzle_guesses g
      where g.play_id=play.id
        and (
          (public.live_feedback(g.guess_word,aw.word)->>'green')::integer<>(g.feedback->>'green')::integer
          or (public.live_feedback(g.guess_word,aw.word)->>'yellow')::integer<>(g.feedback->>'yellow')::integer
          or (public.live_feedback(g.guess_word,aw.word)->>'red')::integer<>(g.feedback->>'red')::integer
        )
    )
  order by
    (public.live_feedback(aw.word,secret)->>'green')::integer desc,
    (public.live_feedback(aw.word,secret)->>'yellow')::integer desc,
    random()
  limit 1;

  -- 2) Olası cevap havuzu tek cevaba düştüyse, aynı yeşil seviyesini koruyan farklı geçerli tahmin seç.
  if hint is null then
    select w.word into hint
    from public.multiplayer_guess_words w
    where w.length=p.word_length
      and w.word<>secret
      and not exists(
        select 1 from public.custom_puzzle_guesses pg
        where pg.play_id=play.id and pg.guess_word=w.word
      )
      and (public.live_feedback(w.word,secret)->>'green')::integer>=best_green
    order by
      (public.live_feedback(w.word,secret)->>'green')::integer desc,
      (public.live_feedback(w.word,secret)->>'yellow')::integer desc,
      random()
    limit 1;
  end if;

  -- 3) Yeşil tabanını koruyan farklı kelime yoksa cevabı vermek yerine en yakın farklı tahmini kullan.
  if hint is null then
    select w.word into hint
    from public.multiplayer_guess_words w
    where w.length=p.word_length
      and w.word<>secret
      and not exists(
        select 1 from public.custom_puzzle_guesses pg
        where pg.play_id=play.id and pg.guess_word=w.word
      )
    order by
      (public.live_feedback(w.word,secret)->>'green')::integer desc,
      ((public.live_feedback(w.word,secret)->>'green')::integer +
       (public.live_feedback(w.word,secret)->>'yellow')::integer) desc,
      random()
    limit 1;
  end if;

  if hint is null then
    raise exception 'Cevabı vermeden üretilebilecek uygun bir ipucu kalmadı';
  end if;

  fb:=public.live_feedback(hint,secret);
  public_fb:=fb-'pattern';
  next_attempt:=play.attempts_used+1;

  insert into public.custom_puzzle_guesses(play_id,guess_no,guess_word,feedback,solved)
  values(play.id,next_attempt,hint,public_fb,false);

  update public.custom_puzzle_plays
  set attempts_used=next_attempt,
      hint_used=true,
      won=false,
      status=case when next_attempt>=p.attempt_limit then 'ended' else 'active' end,
      ended_at=case when next_attempt>=p.attempt_limit then clock_timestamp() else null end
  where id=play.id;

  return public.get_custom_puzzle_state(code);
end;
$$;

revoke all on function public.use_custom_puzzle_hint(text) from public, anon;
grant execute on function public.use_custom_puzzle_hint(text) to authenticated;
