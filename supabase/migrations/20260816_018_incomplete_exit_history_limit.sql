-- Kelimelik v1.2.28 — incomplete exits do not affect stats/history
-- 2026-08-16
--
-- A player leaving an unfinished live/bot match cancels the match instead of
-- recording a forfeit loss. Cancelled matches are intentionally excluded from
-- record_*_stats and get_my_recent_match_history (which only returns ended rows).
-- A disconnect that remains stale for 20 seconds follows the same incomplete
-- cancellation policy.

create or replace function public.leave_live_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  m public.live_matches%rowtype;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;

  select * into m from public.live_matches where id=p_match_id for update;
  if not found or uid not in (m.host_id,m.guest_id) then raise exception 'Maça erişim yok'; end if;
  if m.status in ('ended','cancelled') then return public.get_live_match_state(m.id); end if;

  update public.live_matches
    set status='cancelled',
        winner_id=null,
        end_reason='cancelled',
        ended_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where id=m.id;

  -- Deliberately do not call record_live_match_stats for an unfinished exit.
  return public.get_live_match_state(m.id);
end;
$$;

create or replace function public.claim_live_disconnect_win(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  m public.live_matches%rowtype;
  opponent public.live_match_players%rowtype;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;

  select * into m from public.live_matches where id=p_match_id for update;
  if not found or uid not in (m.host_id,m.guest_id) then raise exception 'Maça erişim yok'; end if;
  if m.status in ('ended','cancelled') then return public.get_live_match_state(m.id); end if;
  if m.guest_id is null then return public.get_live_match_state(m.id); end if;

  update public.live_match_players
    set last_seen_at=clock_timestamp()
    where match_id=m.id and player_id=uid;

  select * into opponent
  from public.live_match_players
  where match_id=m.id and player_id<>uid
  limit 1;

  if not found or opponent.last_seen_at>clock_timestamp()-interval '20 seconds' then
    return public.get_live_match_state(m.id);
  end if;

  update public.live_matches
    set status='cancelled',
        winner_id=null,
        end_reason='cancelled',
        ended_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where id=m.id;

  -- A disconnected unfinished match is not counted for either player.
  return public.get_live_match_state(m.id);
end;
$$;

create or replace function public.leave_bot_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  m public.bot_matches%rowtype;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;

  select * into m from public.bot_matches where id=p_match_id for update;
  if not found or m.player_id<>uid then raise exception 'Maça erişim yok'; end if;
  if m.status in ('ended','cancelled') then return public.get_bot_match_state(m.id); end if;

  update public.bot_matches
    set status='cancelled',
        winner_kind=null,
        end_reason='cancelled',
        ended_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where id=m.id;

  -- Deliberately do not call record_bot_match_stats for an unfinished exit.
  return public.get_bot_match_state(m.id);
end;
$$;

revoke all on function public.leave_live_match(uuid) from public, anon;
grant execute on function public.leave_live_match(uuid) to authenticated;
revoke all on function public.claim_live_disconnect_win(uuid) from public, anon;
grant execute on function public.claim_live_disconnect_win(uuid) to authenticated;
revoke all on function public.leave_bot_match(uuid) from public, anon;
grant execute on function public.leave_bot_match(uuid) to authenticated;
