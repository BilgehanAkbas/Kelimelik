const fs=require("fs");
const path=require("path");
const assert=require("assert");
const ROOT=path.resolve(__dirname,"..");
const sql=fs.readFileSync(path.join(ROOT,"supabase","migrations","20260818_032_bot_deadlock_live_a3.sql"),"utf8");

assert(sql.includes("create or replace function public.advance_bot_match"));
assert(sql.includes("set bot_attempts_used=attempt_limit"));
assert(sql.includes("bot_next_guess_at=null"));
assert(sql.includes("if m.player_attempts_used>=m.attempt_limit and m.player_solved_at is null then"));
assert(sql.includes("perform public.record_bot_match_stats(m.id)"));
assert(!sql.includes("guess:=secret"));

for(const fn of ["create_live_match","enter_quick_match","request_live_rematch"]){
  assert(sql.includes(`create or replace function public.${fn}`),`${fn} 032'de yok`);
}
assert((sql.match(/values\([^;]*'A3'/g)||[]).length>=3,"Canlı secret insertleri A3 değil");
assert((sql.match(/pick_fresh_multiplayer_answer/g)||[]).length>=3,"A3 fresh picker kullanılmıyor");
assert(!/answer_version='A1'/.test(sql),"032 canlı akışında A1 seçimi kalmış");
assert.strictEqual((sql.match(/\$\$/g)||[]).length%2,0,"SQL $$ delimiter dengesiz");

console.log("✓ Bot deadlock guard ve doğrudan A3 live answer smoke testi");
