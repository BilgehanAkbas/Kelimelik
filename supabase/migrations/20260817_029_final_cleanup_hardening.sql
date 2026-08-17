-- Final Kelimelik production cleanup.
-- Keeps gameplay/history data intact while removing unused helpers and transient leftovers.

-- Remove stale quick-match queue rows only; match history remains untouched.
delete from public.quick_match_queue q
where (q.status='waiting' and q.last_seen_at < clock_timestamp()-interval '45 seconds')
   or (q.status='matched' and (
        q.updated_at < clock_timestamp()-interval '15 minutes'
        or q.match_id is null
        or exists (
          select 1
          from public.live_matches m
          where m.id=q.match_id
            and m.status in ('ended','cancelled')
        )
      ));

-- A2 freshness trigger helpers were superseded by the active A3 helpers.
drop function if exists public.enforce_fresh_bot_answer_a2();
drop function if exists public.enforce_fresh_live_answer_a2();

-- These legacy RPCs remain as internal implementations used by the current wrappers,
-- but should no longer be callable directly from the browser/API roles.
revoke all on function public.create_live_match(text,integer) from public, anon, authenticated;
revoke all on function public.join_live_match(text) from public, anon, authenticated;
revoke all on function public.live_heartbeat(uuid) from public, anon, authenticated;

-- Explicitly preserve the public browser-facing wrapper RPCs.
grant execute on function public.create_private_live_match(text,integer) to authenticated;
grant execute on function public.join_private_live_match(text) to authenticated;
grant execute on function public.heartbeat_live_match(uuid) to authenticated;

-- The HTTP extension was only needed for the one-time TDK synchronization migration.
-- No runtime object depends on it anymore.
drop extension if exists http;
