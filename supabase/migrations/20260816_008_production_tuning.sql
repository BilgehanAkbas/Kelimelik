-- Kelimelik production tuning v1.2.8
-- Supabase Performance Advisor doğrultusunda FK indeksleri ve RLS initplan optimizasyonu.

create index if not exists bot_matches_parent_match_idx on public.bot_matches(parent_match_id);
create index if not exists custom_puzzle_plays_player_idx on public.custom_puzzle_plays(player_id);
create index if not exists custom_puzzles_creator_idx on public.custom_puzzles(creator_id);
create index if not exists live_match_guesses_player_idx on public.live_match_guesses(player_id);
create index if not exists live_match_players_player_idx on public.live_match_players(player_id);
create index if not exists live_match_reactions_sender_idx on public.live_match_reactions(sender_id);
create index if not exists live_matches_guest_idx on public.live_matches(guest_id);
create index if not exists live_matches_host_idx on public.live_matches(host_id);
create index if not exists live_matches_parent_match_idx on public.live_matches(parent_match_id);
create index if not exists live_matches_rematch_match_idx on public.live_matches(rematch_match_id);
create index if not exists live_matches_rematch_requested_by_idx on public.live_matches(rematch_requested_by);
create index if not exists live_matches_winner_idx on public.live_matches(winner_id);
create index if not exists quick_match_queue_match_idx on public.quick_match_queue(match_id);

drop policy if exists "participants can read live matches" on public.live_matches;
create policy "participants can read live matches"
on public.live_matches for select
to authenticated
using (((select auth.uid()) = host_id) or ((select auth.uid()) = guest_id));
