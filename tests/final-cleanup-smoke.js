const fs=require("fs");
const path=require("path");
const assert=require("assert");

const ROOT=path.resolve(__dirname,"..");
const file=path.join(ROOT,"supabase","migrations","20260817_029_final_cleanup_hardening.sql");
const sql=fs.readFileSync(file,"utf8").toLowerCase();

assert(sql.includes("delete from public.quick_match_queue"));
assert(sql.includes("status='waiting'"));
assert(sql.includes("status='matched'"));
assert(sql.includes("interval '45 seconds'"));
assert(sql.includes("interval '15 minutes'"));

assert(sql.includes("drop function if exists public.enforce_fresh_bot_answer_a2()"));
assert(sql.includes("drop function if exists public.enforce_fresh_live_answer_a2()"));

for(const fn of [
  "public.create_live_match(text,integer)",
  "public.join_live_match(text)",
  "public.live_heartbeat(uuid)"
]){
  assert(sql.includes(`revoke all on function ${fn} from public, anon, authenticated`),fn);
}

for(const fn of [
  "public.create_private_live_match(text,integer)",
  "public.join_private_live_match(text)",
  "public.heartbeat_live_match(uuid)"
]){
  assert(sql.includes(`grant execute on function ${fn} to authenticated`),fn);
}

assert(sql.includes("drop extension if exists http"));

// Final cleanup must never erase durable game/profile/history tables.
for(const dangerous of [
  "drop table",
  "delete from public.profiles",
  "delete from public.live_matches",
  "delete from public.bot_matches",
  "delete from public.multiplayer_stats"
]){
  assert(!sql.includes(dangerous),dangerous);
}

console.log("✓ Final cleanup yalnız geçici/obsolete nesneleri temizliyor");
