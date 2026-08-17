-- Kelimelik / Kelime Avcısı
-- Production privilege hardening
-- 2026-08-16
--
-- Amaç:
-- * RLS'nin kapsamadığı TRUNCATE / TRIGGER / REFERENCES / MAINTAIN gibi
--   tablo ayrıcalıklarını istemci rollerinden kaldırmak.
-- * Identity sequence ayrıcalıklarını istemci rollerinden kaldırmak.
-- * Gelecekte oluşturulacak public tablo/sequence/function'ların aynı geniş
--   varsayılan ayrıcalıkları yeniden almamasını sağlamak.
-- * Realtime için yalnızca gerekli SELECT erişimini participant RLS ile bırakmak.

revoke create on schema public from public, anon, authenticated;

-- Bu projede public schema yalnızca uygulama tablolarını içerir. Önce tüm
-- istemci tablo ayrıcalıklarını kaldırıp gereken minimum erişimi geri veriyoruz.
revoke all privileges on all tables in schema public from public, anon, authenticated;
revoke all privileges on all sequences in schema public from public, anon, authenticated;

-- Realtime postgres_changes aboneliklerinin çalışması için authenticated rolü
-- bu dört tabloyu SELECT edebilmelidir. Satır kapsamı aşağıdaki RLS politikaları
-- tarafından sadece maç katılımcılarıyla sınırlandırılır.
grant select on public.live_matches to authenticated;
grant select on public.live_match_players to authenticated;
grant select on public.live_match_guesses to authenticated;
grant select on public.live_match_reactions to authenticated;

alter table public.live_matches enable row level security;
alter table public.live_match_players enable row level security;
alter table public.live_match_guesses enable row level security;
alter table public.live_match_reactions enable row level security;

drop policy if exists "participants can read live matches" on public.live_matches;
create policy "participants can read live matches"
on public.live_matches for select
to authenticated
using (((select auth.uid()) = host_id) or ((select auth.uid()) = guest_id));

drop policy if exists "participants can read live players" on public.live_match_players;
create policy "participants can read live players"
on public.live_match_players for select
to authenticated
using (public.is_live_match_participant(match_id));

drop policy if exists "participants can read live guesses" on public.live_match_guesses;
create policy "participants can read live guesses"
on public.live_match_guesses for select
to authenticated
using (public.is_live_match_participant(match_id));

drop policy if exists "participants can read live reactions" on public.live_match_reactions;
create policy "participants can read live reactions"
on public.live_match_reactions for select
to authenticated
using (public.is_live_match_participant(match_id));

-- RPC-only tabloların yanlışlıkla açık bir SELECT policy'si kalmasın.
drop policy if exists "authenticated can read multiplayer length stats"
on public.multiplayer_stats_by_length;

-- PostgreSQL/Supabase tarafından gelecekte public şemasında oluşturulan nesneler
-- istemci rollerine otomatik geniş ayrıcalık vermemeli.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- `supabase_admin` platform tarafından yönetilen bir roldür ve normal migration
-- yürütücüsü bu rolün default ACL değerlerini değiştiremez. Uygulamanın kendi
-- migration nesneleri postgres sahibi olduğu için postgres default privileges
-- burada kapatılır; mevcut bütün public nesneler ayrıca yukarıda tek tek revoke
-- edildiğinden istemci saldırı yüzeyi açık kalmaz.

-- Mevcut istemci RPC izinlerini bu migration topluca değiştirmez. Bunlar önceki
-- migrationlarda fonksiyon bazında REVOKE/GRANT ile tanımlıdır. Böylece oyun API'si
-- çalışmaya devam ederken doğrudan tablo/sequence saldırı yüzeyi kapanır.
