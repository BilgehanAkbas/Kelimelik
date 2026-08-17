-- Kelimelik / Kelime Avcısı
-- Profil + istatistik düzenlemeleri
-- 2026-08-16
--
-- Güvenlik notu:
-- Özel bulmaca doğrulaması yalnızca istemciye bırakılmaz. Cevap ve tahminler
-- backend'de de multiplayer_guess_words üzerinden doğrulanır.

create or replace function public.reset_my_multiplayer_stats()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Oturum gerekli';
  end if;

  update public.multiplayer_stats
  set matches=0,
      wins=0,
      losses=0,
      draws=0,
      current_streak=0,
      max_streak=0,
      solved_matches=0,
      total_solve_guesses=0,
      total_solve_ms=0,
      updated_at=clock_timestamp()
  where player_id=uid;

  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.reset_my_multiplayer_stats()
from public, anon;
grant execute on function public.reset_my_multiplayer_stats()
to authenticated;


create or replace function public.create_custom_puzzle(
  p_mode text,
  p_length integer,
  p_answer text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_mode text := lower(btrim(coalesce(p_mode,'')));
  clean_length integer := p_length;
  attempts integer;
  answer text := upper(btrim(coalesce(p_answer,'')));
  new_id uuid := gen_random_uuid();
  code text;
  expires timestamptz := clock_timestamp()+interval '90 days';
begin
  if uid is null then
    raise exception 'Oturum gerekli';
  end if;

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

  if char_length(answer)<>clean_length
     or answer !~ '^[A-ZÇĞİÖŞÜ]+$' then
    raise exception 'Gizli kelime seçilen harf sayısıyla uyumlu değil';
  end if;

  if not exists(
    select 1
    from public.multiplayer_guess_words w
    where w.length=clean_length
      and w.word=answer
  ) then
    raise exception 'Bu kelime henüz desteklenmiyor. Başka bir kelime deneyin.';
  end if;

  code:=public.make_custom_puzzle_code();

  insert into public.custom_puzzles(
    id,puzzle_code,creator_id,mode,word_length,attempt_limit,expires_at
  ) values(
    new_id,code,uid,clean_mode,clean_length,attempts,expires
  );

  insert into public.custom_puzzle_secrets(puzzle_id,answer_word)
  values(new_id,answer);

  return jsonb_build_object(
    'puzzleCode',code,
    'mode',clean_mode,
    'wordLength',clean_length,
    'attemptLimit',attempts,
    'createdAt',clock_timestamp(),
    'expiresAt',expires
  );
end;
$$;

revoke all on function public.create_custom_puzzle(text,integer,text)
from public, anon;
grant execute on function public.create_custom_puzzle(text,integer,text)
to authenticated;


create or replace function public.submit_custom_puzzle_guess(
  p_puzzle_code text,
  p_guess text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  code text := upper(btrim(coalesce(p_puzzle_code,'')));
  guess text := upper(btrim(coalesce(p_guess,'')));
  p public.custom_puzzles%rowtype;
  play public.custom_puzzle_plays%rowtype;
  secret text;
  fb jsonb;
  public_fb jsonb;
  next_attempt integer;
  solved boolean;
begin
  if uid is null then
    raise exception 'Oturum gerekli';
  end if;

  select * into p
  from public.custom_puzzles
  where puzzle_code=code and enabled
  for update;

  if not found then
    raise exception 'Özel bulmaca bulunamadı';
  end if;

  select * into play
  from public.custom_puzzle_plays
  where puzzle_id=p.id and player_id=uid
  for update;

  if not found then
    perform public.get_custom_puzzle_state(code);
    select * into play
    from public.custom_puzzle_plays
    where puzzle_id=p.id and player_id=uid
    for update;
  end if;

  if play.status='ended' then
    return public.get_custom_puzzle_state(code);
  end if;

  if p.expires_at<=clock_timestamp() then
    raise exception 'Bu özel bulmacanın süresi dolmuş';
  end if;

  if char_length(guess)<>p.word_length
     or guess !~ '^[A-ZÇĞİÖŞÜ]+$' then
    raise exception 'Tahmin seçilen harf sayısıyla uyumlu değil';
  end if;

  if not exists(
    select 1
    from public.multiplayer_guess_words w
    where w.length=p.word_length
      and w.word=guess
  ) then
    raise exception 'Bu kelime henüz desteklenmiyor. Başka bir kelime deneyin.';
  end if;

  select s.answer_word into secret
  from public.custom_puzzle_secrets s
  where s.puzzle_id=p.id;

  if secret is null then
    raise exception 'Gizli cevap bulunamadı';
  end if;

  fb:=public.live_feedback(guess,secret);
  public_fb:=case when p.mode='kelimelik' then fb-'pattern' else fb end;
  next_attempt:=play.attempts_used+1;
  solved:=guess=secret;

  insert into public.custom_puzzle_guesses(
    play_id,guess_no,guess_word,feedback,solved
  ) values(
    play.id,next_attempt,guess,public_fb,solved
  );

  update public.custom_puzzle_plays
  set attempts_used=next_attempt,
      won=solved,
      status=case
        when solved or next_attempt>=p.attempt_limit then 'ended'
        else 'active'
      end,
      ended_at=case
        when solved or next_attempt>=p.attempt_limit then clock_timestamp()
        else null
      end
  where id=play.id;

  return public.get_custom_puzzle_state(code);
end;
$$;

revoke all on function public.submit_custom_puzzle_guess(text,text)
from public, anon;
grant execute on function public.submit_custom_puzzle_guess(text,text)
to authenticated;
