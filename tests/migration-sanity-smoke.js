const fs=require("fs");
const path=require("path");
const assert=require("assert");
const ROOT=path.resolve(__dirname,"..");
const DIR=path.join(ROOT,"supabase","migrations");
const files=fs.readdirSync(DIR).filter(x=>x.endsWith(".sql")).sort();
assert.deepStrictEqual(files,[
  "20260815_001_online_foundation.sql",
  "20260815_002_live_multiplayer.sql",
  "20260815_003_multiplayer_word_seed.sql",
  "20260815_004_quick_match_bot.sql",
  "20260815_005_custom_puzzle_social.sql",
  "20260816_006_release_audit_hardening.sql",
  "20260816_007_word_pool_expansion.sql",
  "20260816_008_production_tuning.sql",
  "20260816_009_classic_lengths.sql",
  "20260816_010_profile_stats_custom_word.sql",
  "20260816_011_proper_name_supplement.sql",
  "20260816_012_multiplayer_length_stats.sql",
  "20260816_013_security_privilege_hardening.sql",
  "20260816_014_bot_fairness_live_invalid_feedback.sql",
  "20260816_015_online_match_history.sql",
  "20260816_016_bot_progressive_guessing.sql",
  "20260816_017_defne_early_game_nerf.sql",
  "20260816_018_incomplete_exit_history_limit.sql",
  "20260816_019_bot_no_repeat.sql",
  "20260816_020_hint_no_auto_win.sql",
  "20260816_021_answer_pool_a2_refresh.sql",
  "20260817_022_word_pool_quality_a3.sql",
  "20260817_023_tdk_canonical_word_pool_a3.sql",
  "20260817_024_a3_helper_execute_hardening.sql",
  "20260817_025_online_timer_result_ux.sql",
  "20260817_026_efe_nerf.sql",
  "20260817_027_bot_accuracy_progression.sql",
  "20260817_028_bot_logic_rebalance.sql",
  "20260817_029_final_cleanup_hardening.sql"
]);
const combined=files.map(f=>fs.readFileSync(path.join(DIR,f),"utf8")).join("\n");
for(const file of files){
  const sql=fs.readFileSync(path.join(DIR,file),"utf8");
  assert.strictEqual((sql.match(/\$\$/g)||[]).length%2,0,`${file}: dengesiz $$ delimiter`);
}
const functionBlocks=[...combined.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\([^]*?\n\$\$;/gi)];
assert(functionBlocks.length>=30,"beklenenden az function bulundu");
for(const match of functionBlocks){
  const block=match[0].toLowerCase();
  if(block.includes("security definer")){
    assert(block.includes("set search_path"),`${match[1]} SECURITY DEFINER search_path eksik`);
  }
}
const tables=[...combined.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.([a-z0-9_]+)/gi)].map(x=>x[1]);
for(const table of tables){
  const rls=new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`,`i`);
  assert(rls.test(combined),`${table} RLS etkin değil`);
}

for(const secret of ["live_match_secrets","bot_match_secrets","custom_puzzle_secrets","multiplayer_answer_words","multiplayer_guess_words"]){
  assert(combined.includes(`revoke all on public.${secret} from anon, authenticated`),`${secret} revoke eksik`);
}
assert(!/grant\s+(?:select|insert|update|delete|all)[^;]*live_match_secrets/gi.test(combined));
assert(!/grant\s+(?:select|insert|update|delete|all)[^;]*bot_match_secrets/gi.test(combined));
assert(!/grant\s+(?:select|insert|update|delete|all)[^;]*custom_puzzle_secrets/gi.test(combined));
const readme=fs.readFileSync(path.join(ROOT,"README.md"),"utf8");
assert(readme.includes("supabase/migrations/"));
assert(readme.includes("## Kod Yapısı"));
console.log("✓ Migration sırası, secret grantleri ve SECURITY DEFINER search_path sanity testi");
