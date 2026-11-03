-- Kelimelik production hardening
-- 2026-11-03
--
-- Amaç:
-- * Ücretsiz Supabase projesinin etkinlik olmadığı için duraklatılmasını önlemek:
--   api/keepalive.js günde bir kez keepalive_ping() çağırır.
-- * Tek hesabın sınırsız oda, bot maçı veya özel bulmaca satırı üretmesini önlemek.
-- * Özel bulmaca ipucunu kullanımdan kalkan A1 yerine aktif A3 cevap havuzundan seçmek.

create or replace function public.keepalive_ping()
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$
  select now();
$$;

revoke all on function public.keepalive_ping() from public, authenticated;
grant execute on function public.keepalive_ping() to anon;

create or replace function public.enforce_creation_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recent integer;
begin
  if tg_table_name='custom_puzzles' then
    select count(*) into recent
    from public.custom_puzzles p
    where p.creator_id=new.creator_id
      and p.created_at>clock_timestamp()-interval '1 hour';
    if recent>=20 then
      raise exception 'Özel bulmaca sınırına ulaştın. Biraz sonra tekrar dene.';
    end if;
  elsif tg_table_name='live_matches' then
    select count(*) into recent
    from public.live_matches m
    where m.host_id=new.host_id
      and m.created_at>clock_timestamp()-interval '10 minutes';
    if recent>=30 then
      raise exception 'Çok fazla maç başlattın. Birkaç dakika sonra tekrar dene.';
    end if;
  elsif tg_table_name='bot_matches' then
    select count(*) into recent
    from public.bot_matches m
    where m.player_id=new.player_id
      and m.created_at>clock_timestamp()-interval '10 minutes';
    if recent>=30 then
      raise exception 'Çok fazla maç başlattın. Birkaç dakika sonra tekrar dene.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_creation_rate_limit() from public, anon, authenticated;

drop trigger if exists custom_puzzles_rate_limit on public.custom_puzzles;
create trigger custom_puzzles_rate_limit
before insert on public.custom_puzzles
for each row execute function public.enforce_creation_rate_limit();

drop trigger if exists live_matches_rate_limit on public.live_matches;
create trigger live_matches_rate_limit
before insert on public.live_matches
for each row execute function public.enforce_creation_rate_limit();

drop trigger if exists bot_matches_rate_limit on public.bot_matches;
create trigger bot_matches_rate_limit
before insert on public.bot_matches
for each row execute function public.enforce_creation_rate_limit();

-- Fonksiyonun geri kalanı ve izinleri aynen korunur; yalnız cevap havuzu sürümü değişir.
do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.use_custom_puzzle_hint(text)'::regprocedure) into definition;
  execute replace(definition,'aw.answer_version=''A1''','aw.answer_version=''A3''');
end;
$$;

notify pgrst, 'reload schema';
