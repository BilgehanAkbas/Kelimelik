-- Kelimelik v1.2.22 — bot fairness + multiplayer round-completion clarification
-- 2026-08-16
--
-- Botlar artık her maçta cevabı bulmak zorunda değildir. Oyuncunun tahmin hakkı
-- bittiğinde maç yalnızca rakip de tamamladıysa sonuçlanır; bu davranış mevcut
-- submit/advance fonksiyonlarında korunur. Buradaki değişiklik bot hedef tahminini
-- kimi maçlarda attempt_limit + 1 yaparak botun da tüm haklarında bilememe
-- ihtimalini gerçek hale getirir.

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

  -- Her botun kaybetme/çözememe ihtimali vardır; güç farkı olasılıktan gelir.
  -- Efe: %28, Defne: %15, Atlas: %8 ihtimalle tüm haklarında cevabı bulamaz.
  if (clean_bot='efe' and fail_roll<0.28)
     or (clean_bot='defne' and fail_roll<0.15)
     or (clean_bot='atlas' and fail_roll<0.08)
  then
    target:=attempts+1;
  else
    target:=case clean_bot
      when 'atlas' then 2+floor(random()*greatest(1,least(attempts-1,4)))::integer
      when 'defne' then 2+floor(random()*greatest(1,attempts-1))::integer
      else 2+floor(random()*greatest(1,attempts-1))::integer
    end;
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
