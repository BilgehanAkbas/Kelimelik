-- Kelimelik v1.2.32 — kelime havuzu kalite auditi + A3 cevap havuzu
-- A1/A2 ve D1 dondurulmuş sürümler korunur.
-- Kelimetre karşılaştırması yalnızca aday bulmak için kullanılır; bariz bozuk,
-- ağız/çekim kaynaklı veya oyun cevabı olarak zayıf girdiler otomatik içe alınmaz.

-- Eksik ama güvenli tahminler (guess-only).
insert into public.multiplayer_guess_words(length,word) values
(4,'AURA'),
(4,'BÖRÜ'),
(4,'BAYT'),
(4,'BLOG'),
(4,'URFA'),
(5,'RAYLI'),
(5,'REFLÜ'),
(5,'REMZİ'),
(5,'RONDO'),
(5,'RUMEN'),
(5,'ÜNVAN')
on conflict (length,word) do nothing;

-- Kullanıcı geri bildirimiyle tespit edilen bozuk/istenmeyen tahminler.
delete from public.multiplayer_guess_words
where (length,word) in (
  (4,'BİLİ'),
  (4,'BİŞİ'),
  (4,'KEDI')
);

-- A2'yi A3 tabanı olarak kopyala, yeni oyunlarda görünmesini istemediğimiz
-- çekimli/oyun-cevabı kalitesi düşük birkaç girdiyi dışarıda bırak.
insert into public.multiplayer_answer_words(answer_version,length,word,enabled)
select 'A3',length,word,enabled
from public.multiplayer_answer_words
where answer_version='A2'
  and word not in ('GÖLÜ','ARANAN','EKRANI','EVDEKİ','ÇABUCA','İLERDE')
on conflict (answer_version,length,word) do update set enabled=excluded.enabled;

-- Client A2'de eklenmiş BÖRÜ, A3 backend havuzunda da senkron tutulur.
insert into public.multiplayer_answer_words(answer_version,length,word,enabled)
values ('A3',4,'BÖRÜ',true)
on conflict (answer_version,length,word) do update set enabled=excluded.enabled;

create or replace function public.pick_fresh_multiplayer_answer(
  p_length integer,
  p_player_ids uuid[],
  p_exclude text default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  chosen text;
begin
  if p_length not in (4,5,6) then raise exception 'Geçersiz harf sayısı'; end if;

  select aw.word into chosen
  from public.multiplayer_answer_words aw
  where aw.answer_version='A3'
    and aw.length=p_length
    and aw.enabled=true
    and (p_exclude is null or aw.word<>p_exclude)
    and not exists(
      select 1
      from (
        select history.answer_word
        from (
          select b.ended_at, bs.answer_word
          from public.bot_matches b
          join public.bot_match_secrets bs on bs.match_id=b.id
          where b.status='ended'
            and b.word_length=p_length
            and b.player_id=any(p_player_ids)
          union all
          select l.ended_at, ls.answer_word
          from public.live_matches l
          join public.live_match_secrets ls on ls.match_id=l.id
          where l.status='ended'
            and l.word_length=p_length
            and (l.host_id=any(p_player_ids) or l.guest_id=any(p_player_ids))
        ) history
        order by history.ended_at desc nulls last
        limit 24
      ) recent
      where recent.answer_word=aw.word
    )
  order by random()
  limit 1;

  if chosen is null then
    select aw.word into chosen
    from public.multiplayer_answer_words aw
    where aw.answer_version='A3'
      and aw.length=p_length
      and aw.enabled=true
      and (p_exclude is null or aw.word<>p_exclude)
    order by random()
    limit 1;
  end if;

  -- Güvenli geri uyumluluk: A3 hiç seed edilmemişse eski sürüme düş.
  if chosen is null then
    select aw.word into chosen
    from public.multiplayer_answer_words aw
    where aw.answer_version='A2'
      and aw.length=p_length
      and aw.enabled=true
      and (p_exclude is null or aw.word<>p_exclude)
    order by random()
    limit 1;
  end if;

  if chosen is null then
    select aw.word into chosen
    from public.multiplayer_answer_words aw
    where aw.answer_version='A1'
      and aw.length=p_length
      and aw.enabled=true
      and (p_exclude is null or aw.word<>p_exclude)
    order by random()
    limit 1;
  end if;

  if chosen is null then raise exception 'Online cevap havuzu yüklenmemiş'; end if;
  return chosen;
end;
$$;

create or replace function public.enforce_fresh_live_answer_a3()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  m public.live_matches%rowtype;
  previous_answer text := null;
  players uuid[];
begin
  select * into m from public.live_matches where id=new.match_id;
  if not found then raise exception 'Canlı maç bulunamadı'; end if;

  if m.parent_match_id is not null then
    select s.answer_word into previous_answer
    from public.live_match_secrets s
    where s.match_id=m.parent_match_id;
  end if;

  players:=array_remove(array[m.host_id,m.guest_id]::uuid[],null);
  new.answer_word:=public.pick_fresh_multiplayer_answer(m.word_length,players,previous_answer);
  new.answer_version:='A3';
  return new;
end;
$$;

create or replace function public.enforce_fresh_bot_answer_a3()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  m public.bot_matches%rowtype;
begin
  select * into m from public.bot_matches where id=new.match_id;
  if not found then raise exception 'Bot maçı bulunamadı'; end if;

  new.answer_word:=public.pick_fresh_multiplayer_answer(m.word_length,array[m.player_id]::uuid[],null);
  new.answer_version:='A3';
  return new;
end;
$$;

-- Eski A2 trigger'larıyla çift çalışmayı engelle.
drop trigger if exists trg_live_secret_fresh_a2 on public.live_match_secrets;
drop trigger if exists trg_bot_secret_fresh_a2 on public.bot_match_secrets;
drop trigger if exists trg_live_secret_fresh_a3 on public.live_match_secrets;
drop trigger if exists trg_bot_secret_fresh_a3 on public.bot_match_secrets;

create trigger trg_live_secret_fresh_a3
before insert on public.live_match_secrets
for each row execute function public.enforce_fresh_live_answer_a3();

create trigger trg_bot_secret_fresh_a3
before insert on public.bot_match_secrets
for each row execute function public.enforce_fresh_bot_answer_a3();

revoke all on function public.pick_fresh_multiplayer_answer(integer,uuid[],text) from public, anon, authenticated;
revoke all on function public.enforce_fresh_live_answer_a3() from public, anon, authenticated;
revoke all on function public.enforce_fresh_bot_answer_a3() from public, anon, authenticated;
