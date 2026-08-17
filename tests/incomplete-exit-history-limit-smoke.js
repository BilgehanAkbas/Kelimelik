const fs=require('fs');
const path=require('path');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(ROOT,'src/js/app.js'),'utf8');
const patch=fs.readFileSync(path.join(ROOT,'src/js/ui-patches.js'),'utf8');
const migration=fs.readFileSync(path.join(ROOT,'supabase/migrations/20260816_018_incomplete_exit_history_limit.sql'),'utf8');

assert(app.includes('const MAX_HISTORY=50;'));
assert(patch.includes('rows.slice(0,50)'));
assert(patch.includes('.slice(0,50);'));
assert(patch.includes('ONLINE.getRecentMatchHistory(50)'));
assert(patch.includes('Son 50 tamamlanmış oyun gösterilir.'));
assert(app.includes('Tamamlanmamış maç iptal edilir; Son Oyunlar ve istatistiklere eklenmez.'));

for(const fn of ['leave_live_match','claim_live_disconnect_win','leave_bot_match']){
  assert(migration.includes(`function public.${fn}`));
}
assert((migration.match(/status='cancelled'/g)||[]).length>=3);
assert(!/perform public\.record_live_match_stats\(m\.id\)/.test(migration));
assert(!/perform public\.record_bot_match_stats\(m\.id\)/.test(migration));
assert(migration.includes("grant execute on function public.leave_live_match(uuid) to authenticated"));
assert(migration.includes("grant execute on function public.leave_bot_match(uuid) to authenticated"));
console.log('Incomplete exit + history limit smoke testi geçti.');
