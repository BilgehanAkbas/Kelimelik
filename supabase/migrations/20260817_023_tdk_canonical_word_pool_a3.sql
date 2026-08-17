-- TDK tabanlı 4/5/6 harfli tek sözcük havuzunu kanonik hale getirir.
-- Kaynak: TDK sözlük verisini toplayan ncarkaci/TDKDictionaryCrawler snapshotı.
-- A1/A2 eski oyun kodları için korunur; yeni online cevap sürümü A3'tür.

create extension if not exists http with schema extensions;

create temporary table tdk_canonical_words(
  length smallint not null,
  word text not null,
  primary key(length,word)
) on commit drop;

with src as (
  select content
  from extensions.http_get('https://raw.githubusercontent.com/ncarkaci/TDKDictionaryCrawler/master/TDK_S%C3%B6zl%C3%BCk_Kelime_Listesi.txt')
  where status=200
), lines as (
  select trim(x) raw
  from src, regexp_split_to_table(content, E'\r?\n') x
), normalized as (
  select translate(raw,
    'abcçdefgğhıijklmnoöprsştuüvyzqwxâîûABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZQWXÂÎÛ',
    'ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZQWXAİUABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZQWXAİU') word
  from lines
)
insert into tdk_canonical_words(length,word)
select char_length(word)::smallint, word
from normalized
where word ~ '^[A-ZÇĞİÖŞÜ]+$'
  and char_length(word) between 4 and 6
on conflict do nothing;

delete from public.multiplayer_guess_words g
where not exists(
  select 1 from tdk_canonical_words t
  where t.length=g.length and t.word=g.word
);

insert into public.multiplayer_guess_words(length,word)
select length,word from tdk_canonical_words
on conflict do nothing;

delete from public.multiplayer_answer_words where answer_version='A3';
insert into public.multiplayer_answer_words(answer_version,length,word,enabled)
select 'A3', a.length, a.word, a.enabled
from public.multiplayer_answer_words a
join tdk_canonical_words t on t.length=a.length and t.word=a.word
where a.answer_version='A2';

create or replace function public.pick_fresh_multiplayer_answer(
  p_length integer, p_player_ids uuid[], p_exclude text default null
) returns text
language plpgsql security definer
set search_path to 'public','extensions','pg_temp'
as $function$
declare chosen text;
begin
  if p_length not in (4,5,6) then raise exception 'Geçersiz harf sayısı'; end if;
  select aw.word into chosen
  from public.multiplayer_answer_words aw
  where aw.answer_version='A3' and aw.length=p_length and aw.enabled=true
    and (p_exclude is null or aw.word<>p_exclude)
    and not exists(
      select 1 from (
        select history.answer_word from (
          select b.ended_at,bs.answer_word from public.bot_matches b
          join public.bot_match_secrets bs on bs.match_id=b.id
          where b.status='ended' and b.word_length=p_length and b.player_id=any(p_player_ids)
          union all
          select l.ended_at,ls.answer_word from public.live_matches l
          join public.live_match_secrets ls on ls.match_id=l.id
          where l.status='ended' and l.word_length=p_length
            and (l.host_id=any(p_player_ids) or l.guest_id=any(p_player_ids))
        ) history order by history.ended_at desc nulls last limit 24
      ) recent where recent.answer_word=aw.word
    )
  order by random() limit 1;

  if chosen is null then
    select aw.word into chosen from public.multiplayer_answer_words aw
    where aw.answer_version='A3' and aw.length=p_length and aw.enabled=true
      and (p_exclude is null or aw.word<>p_exclude)
    order by random() limit 1;
  end if;

  if chosen is null then raise exception 'Online cevap havuzu yüklenmemiş'; end if;
  return chosen;
end;
$function$;

create or replace function public.enforce_fresh_bot_answer_a3()
returns trigger language plpgsql security definer
set search_path to 'public','extensions','pg_temp'
as $function$
declare m public.bot_matches%rowtype;
begin
  select * into m from public.bot_matches where id=new.match_id;
  if not found then raise exception 'Bot maçı bulunamadı'; end if;
  new.answer_word:=public.pick_fresh_multiplayer_answer(m.word_length,array[m.player_id]::uuid[],null);
  new.answer_version:='A3';
  return new;
end;
$function$;

create or replace function public.enforce_fresh_live_answer_a3()
returns trigger language plpgsql security definer
set search_path to 'public','extensions','pg_temp'
as $function$
declare m public.live_matches%rowtype; previous_answer text:=null; players uuid[];
begin
  select * into m from public.live_matches where id=new.match_id;
  if not found then raise exception 'Canlı maç bulunamadı'; end if;
  if m.parent_match_id is not null then
    select s.answer_word into previous_answer from public.live_match_secrets s where s.match_id=m.parent_match_id;
  end if;
  players:=array_remove(array[m.host_id,m.guest_id]::uuid[],null);
  new.answer_word:=public.pick_fresh_multiplayer_answer(m.word_length,players,previous_answer);
  new.answer_version:='A3';
  return new;
end;
$function$;

drop trigger if exists trg_bot_secret_fresh_a2 on public.bot_match_secrets;
drop trigger if exists trg_bot_secret_fresh_a3 on public.bot_match_secrets;
create trigger trg_bot_secret_fresh_a3 before insert on public.bot_match_secrets
for each row execute function public.enforce_fresh_bot_answer_a3();

drop trigger if exists trg_live_secret_fresh_a2 on public.live_match_secrets;
drop trigger if exists trg_live_secret_fresh_a3 on public.live_match_secrets;
create trigger trg_live_secret_fresh_a3 before insert on public.live_match_secrets
for each row execute function public.enforce_fresh_live_answer_a3();
