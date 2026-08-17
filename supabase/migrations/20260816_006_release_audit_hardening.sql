-- Kelimelik Online v1.2.4 — Release audit hardening
-- 2026-08-16
-- 001 → 005 sonrasında çalıştırılmalıdır.

-- SECURITY DEFINER fonksiyonlarının search_path riskini azaltmak için
-- uygulama rollerinin public schema altında yeni obje oluşturmasını kapat.
revoke create on schema public from public, anon, authenticated;

-- Profil ve istatistikler istemci tarafından tablo olarak okunup/yazılmaz.
-- Public görünüm yalnızca daraltılmış RPC çıktılarından sağlanır.
revoke select, insert, update, delete on public.profiles from public, anon, authenticated;
revoke select, insert, update, delete on public.multiplayer_stats from public, anon, authenticated;

drop policy if exists "authenticated can read profiles" on public.profiles;
drop policy if exists "owner can update own profile" on public.profiles;
drop policy if exists "authenticated can read multiplayer stats" on public.multiplayer_stats;

-- Trigger/helper fonksiyonları REST/RPC yüzeyinden çağrılmasın.
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.make_player_code() from public, anon, authenticated;


-- Yeni fonksiyonlar yanlışlıkla PUBLIC/anon/authenticated RPC yüzeyine açılmasın.
-- İleride özellikle ihtiyaç duyulan fonksiyonlara ayrıca GRANT EXECUTE verilmelidir.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- Mevcut profile nickname güncellenirken yeni player_code adayı üretme.
-- Yeni profil oluştururken de eşzamanlı code/id unique çakışmalarını kontrollü retry et.
create or replace function public.ensure_profile(p_nickname text)
returns table (
  id uuid,
  nickname text,
  player_code text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_name text := btrim(regexp_replace(coalesce(p_nickname,''), '\s+', ' ', 'g'));
  attempt_no integer;
begin
  if uid is null then
    raise exception 'Oturum gerekli';
  end if;

  if char_length(clean_name) < 2 or char_length(clean_name) > 18 then
    raise exception 'Takma ad 2-18 karakter olmalı';
  end if;

  if clean_name !~ '^[A-Za-zÇĞİÖŞÜçğıöşü0-9 _.-]+$' then
    raise exception 'Takma ad geçersiz karakter içeriyor';
  end if;

  update public.profiles p
  set nickname=clean_name,
      updated_at=clock_timestamp()
  where p.id=uid;

  if not found then
    for attempt_no in 1..20 loop
      begin
        insert into public.profiles(id,nickname,player_code)
        values(uid,clean_name,public.make_player_code());
        exit;
      exception when unique_violation then
        -- Aynı auth UID başka sekmede az önce oluşturulduysa kodunu koruyup nickname'i güncelle.
        if exists(select 1 from public.profiles p where p.id=uid) then
          update public.profiles p
          set nickname=clean_name,
              updated_at=clock_timestamp()
          where p.id=uid;
          exit;
        end if;
        if attempt_no=20 then
          raise exception 'Oyuncu kodu üretilemedi';
        end if;
      end;
    end loop;
  end if;

  insert into public.multiplayer_stats(player_id,mode)
  values (uid,'overall'),(uid,'kelimelik'),(uid,'classic')
  on conflict (player_id,mode) do nothing;

  return query
  select p.id,p.nickname,p.player_code,p.created_at
  from public.profiles p
  where p.id=uid;
end;
$$;

revoke all on function public.ensure_profile(text) from public, anon;
grant execute on function public.ensure_profile(text) to authenticated;

-- Kullanıcı tarafından oluşturulan özel bulmacanın bir public profile bağlı
-- olması zorunlu: creator kartı ve oyuncu kodu her zaman tutarlı kalsın.
create or replace function public.create_custom_puzzle(p_mode text,p_length integer,p_answer text)
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
  if uid is null then raise exception 'Oturum gerekli'; end if;
  if not exists(select 1 from public.profiles where id=uid) then
    raise exception 'Önce oyuncu profili oluştur';
  end if;

  if clean_mode='classic' then
    clean_length:=5;
    attempts:=6;
  elsif clean_mode='kelimelik' and clean_length in (4,5,6) then
    attempts:=8;
  else
    raise exception 'Geçersiz oyun modu';
  end if;

  if char_length(answer)<>clean_length or answer !~ '^[A-ZÇĞİÖŞÜ]+$' then
    raise exception 'Gizli kelime seçilen harf sayısıyla uyumlu değil';
  end if;

  if not exists(
    select 1 from public.multiplayer_guess_words w
    where w.length=clean_length and w.word=answer
  ) then
    raise exception 'Bu kelime Kelimelik tahmin sözlüğünde bulunmuyor';
  end if;

  code:=public.make_custom_puzzle_code();

  insert into public.custom_puzzles(id,puzzle_code,creator_id,mode,word_length,attempt_limit,expires_at)
  values(new_id,code,uid,clean_mode,clean_length,attempts,expires);

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

revoke all on function public.create_custom_puzzle(text,integer,text) from public, anon;
grant execute on function public.create_custom_puzzle(text,integer,text) to authenticated;

-- Hızlı tepkiler yalnızca aktif insan maçında kabul edilir.
-- Böylece bitmiş maçlara devtools/RPC üzerinden sınırsız reaction satırı eklenemez.
drop function if exists public.send_live_reaction(uuid,text);

create or replace function public.send_live_reaction(p_match_id uuid,p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_emoji text := btrim(coalesce(p_emoji,''));
  reaction_id bigint;
  match_status text;
  match_started_at timestamptz;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  if clean_emoji not in ('👍','👏','🔥','😅','😮','💀') then raise exception 'Geçersiz tepki'; end if;

  select m.status,m.started_at into match_status,match_started_at
  from public.live_matches m
  where m.id=p_match_id and uid in (m.host_id,m.guest_id)
  for update;

  if not found then raise exception 'Maça erişim yok'; end if;

  -- İstemcide geri sayım server saatine göre bitmişse heartbeat'i beklemeden
  -- maçı active'a geçir; submit_live_guess ile aynı geçiş davranışı.
  if match_status='countdown' and match_started_at is not null and match_started_at<=clock_timestamp() then
    update public.live_matches
    set status='active',updated_at=clock_timestamp()
    where id=p_match_id;
    match_status:='active';
  end if;

  if match_status<>'active' then raise exception 'Tepkiler yalnızca aktif maçta kullanılabilir'; end if;

  if exists(
    select 1 from public.live_match_reactions r
    where r.match_id=p_match_id and r.sender_id=uid
      and r.created_at>clock_timestamp()-interval '1 second'
  ) then
    raise exception 'Çok hızlı tepki gönderiyorsun';
  end if;

  insert into public.live_match_reactions(match_id,sender_id,emoji)
  values(p_match_id,uid,clean_emoji)
  returning id into reaction_id;

  return jsonb_build_object('id',reaction_id,'emoji',clean_emoji,'senderId',uid,'createdAt',clock_timestamp());
end;
$$;

revoke all on function public.send_live_reaction(uuid,text) from public, anon;
grant execute on function public.send_live_reaction(uuid,text) to authenticated;
