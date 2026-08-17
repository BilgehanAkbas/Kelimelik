const fs=require("fs");
const path=require("path");
const assert=require("assert");
const ROOT=path.resolve(__dirname,"..");
const migration=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260816_015_online_match_history.sql"),"utf8");
const resultUx=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260817_025_online_timer_result_ux.sql"),"utf8");
const online=fs.readFileSync(path.join(ROOT,"src/js/online.js"),"utf8");
const patch=fs.readFileSync(path.join(ROOT,"src/js/ui-patches.js"),"utf8");
const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");

assert(migration.includes("create or replace function public.get_my_recent_match_history"));
assert(migration.includes("where m.status = 'ended'"));
assert(migration.includes("join public.live_match_secrets"));
assert(migration.includes("join public.bot_match_secrets"));
assert(migration.includes("m.player_id = uid"));
assert(migration.includes("uid in (m.host_id, m.guest_id)"));
assert(migration.includes("revoke all on function public.get_my_recent_match_history(integer) from public, anon"));
assert(migration.includes("grant execute on function public.get_my_recent_match_history(integer) to authenticated"));
assert(!/grant\s+select\s+on\s+public\.(live_match_secrets|bot_match_secrets)/i.test(migration));
assert(resultUx.includes("durationSeconds"));
assert(resultUx.includes("coalesce(me.solved_at,m.ended_at"));
assert(resultUx.includes("coalesce(m.player_solved_at,m.ended_at"));

assert(online.includes('async function getRecentMatchHistory(limit=50)'));
assert(online.includes('rpc("get_my_recent_match_history"'));
assert(online.includes('getRecentMatchHistory,'));

assert(patch.includes('ONLINE_HISTORY_CACHE_KEY'));
assert(patch.includes('ONLINE?.getRecentMatchHistory'));
assert(patch.includes('history-online-badge'));
assert(patch.includes('Online · ${kind} · ${mode} · ${item.length} Harf'));
assert(patch.includes('Online maç geçmişi yükleniyor…'));
assert(patch.includes('closeAction:showProfileModal'));
assert(!patch.includes('id="profileHistoryBtn">★ Kelime Geçmişi & Favoriler</button>'));
assert(css.includes('.profile-form .profile-error:empty{display:none}'));
assert(css.includes('.history-item-online'));

console.log("✓ Online maç geçmişi, ONLINE etiketi ve profil formu cilası smoke testi");
