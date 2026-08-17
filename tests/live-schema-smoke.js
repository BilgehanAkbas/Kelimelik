const fs=require("fs");
const path=require("path");
const vm=require("vm");
const assert=require("assert");

const ROOT=path.resolve(__dirname,"..");
const schema=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260815_002_live_multiplayer.sql"),"utf8");
const seed=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260815_003_multiplayer_word_seed.sql"),"utf8");
const quickBot=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260815_004_quick_match_bot.sql"),"utf8");
const expansion=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260816_007_word_pool_expansion.sql"),"utf8");
const properNames=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260816_011_proper_name_supplement.sql"),"utf8");
const a2Refresh=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260816_021_answer_pool_a2_refresh.sql"),"utf8");
const qualityA3=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260817_022_word_pool_quality_a3.sql"),"utf8");
const tdkCanonical=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260817_023_tdk_canonical_word_pool_a3.sql"),"utf8");
const resultUx=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260817_025_online_timer_result_ux.sql"),"utf8");

for(const table of ["multiplayer_answer_words","multiplayer_guess_words","live_matches","live_match_secrets","live_match_players","live_match_guesses","live_match_reactions"]){
  assert(schema.includes(`create table if not exists public.${table}`),table);
}
for(const fn of ["create_private_live_match","join_private_live_match","get_live_match_state","submit_live_guess","heartbeat_live_match","claim_live_disconnect_win","send_live_reaction","request_live_rematch"]){
  assert(schema.includes(`function public.${fn}`),fn);
}
assert(schema.includes("fb-'pattern'"),"Kelimelik modunda per-letter pattern dışarı açılmamalı");
assert(schema.includes("interval '20 seconds'"),"20 saniyelik reconnect kuralı eksik");
assert(schema.includes("rematch_match_id"),"rövanş bağlantısı eksik");
assert(schema.includes("revoke all on public.live_match_secrets from anon, authenticated"));
assert(!/grant\s+select\s+on\s+public\.live_match_secrets/i.test(schema));
assert(schema.includes("alter publication supabase_realtime add table public.live_match_guesses"));
assert(schema.includes("emoji in ('👍','👏','🔥','😅','😮','💀')"));

const ctx={window:{}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT,"src/js/word-pools.js"),"utf8"),ctx);
const guesses=ctx.window.KELIMELIK_WORD_POOLS;
const answers=ctx.window.KELIMELIK_ANSWER_POOLS.A1;
const answersA2=ctx.window.KELIMELIK_ANSWER_POOLS.A2;
const a2GuessBlock=a2Refresh.split("-- A1'i A2'nin tabanı olarak kopyala.")[0];
const a2SupplementBlock=a2Refresh.split("-- Frekans/yaygınlık odaklı kontrollü A2 cevap takviyesi.")[1].split(") as v(length,word)")[0];

for(const len of [4,5,6]){
  const answerMatches=[...seed.matchAll(new RegExp(`\\('A1',${len},'([^']+)'\\)`,`g`))].map(m=>m[1]);
  const baseGuessMatches=[...seed.matchAll(new RegExp(`\\(${len},'([^']+)'\\)`,`g`))].map(m=>m[1]);
  const expansionGuessMatches=[...expansion.matchAll(new RegExp(`\\(${len},'([^']+)'\\)`,`g`))].map(m=>m[1]);
  const properGuessMatches=[...properNames.matchAll(/\((4|5|6),'([^']+)'\)/g)].filter(m=>Number(m[1])===len).map(m=>m[2]);
  const a2GuessMatches=[...a2GuessBlock.matchAll(/\((4|5|6),'([^']+)'\)/g)].filter(m=>Number(m[1])===len).map(m=>m[2]);
  const qualityGuessBlock=qualityA3.split("-- Kullanıcı geri bildirimiyle tespit edilen")[0];
  const qualityGuessMatches=[...qualityGuessBlock.matchAll(/\((4|5|6),'([^']+)'\)/g)].filter(m=>Number(m[1])===len).map(m=>m[2]);
  const removedGuessMatches=[...qualityA3.split("delete from public.multiplayer_guess_words")[1].split(";")[0].matchAll(/\((4|5|6),'([^']+)'\)/g)].filter(m=>Number(m[1])===len).map(m=>m[2]);
  const removed=new Set(removedGuessMatches);
  const guessMatches=[...new Set([...baseGuessMatches,...expansionGuessMatches,...properGuessMatches,...a2GuessMatches,...qualityGuessMatches])].filter(word=>!removed.has(word));
  assert.strictEqual(answerMatches.length,answers[String(len)].length,`A1 ${len} cevap seed sayısı`);
  assert.deepStrictEqual(new Set(answerMatches),new Set(answers[String(len)]));

  /* TDK kanonik migrationı artık online guess tablosunu çalışma anında TDK
     listesine göre tamamen eşitlediği için, eski seed+expansion sayısını
     frontend fallback havuzuyla birebir kıyaslamak doğru değil. */
  assert(guessMatches.length>0,`${len} eski tahmin seed zinciri boş olmamalı`);
  assert(guesses[String(len)].length>0,`${len} frontend fallback havuzu boş olmamalı`);
}


assert(tdkCanonical.includes("extensions.http_get("),"TDK kanonik migrationı TDK snapshotını çekmeli");
assert(tdkCanonical.includes("delete from public.multiplayer_guess_words"),"TDK dışı online tahminler temizlenmeli");
assert(tdkCanonical.includes("insert into public.multiplayer_guess_words"),"TDK kelimeleri online tahmin havuzuna eklenmeli");
assert(tdkCanonical.includes("answer_version='A3'"),"Yeni online cevap sürümü A3 olmalı");
assert(tdkCanonical.includes("new.answer_version:='A3'"),"Canlı/bot secret triggerları A3 kullanmalı");

assert(resultUx.includes("if m.status in ('ended','cancelled') then"),"Cevap yalnız maç bittikten sonra açılmalı");
assert((resultUx.match(/'answerWord',answer/g)||[]).length>=2,"Canlı ve bot sonuç state'i answerWord döndürmeli");

assert(a2Refresh.includes("select 'A2',length,word,enabled"));
assert(a2Refresh.includes("where answer_version='A1'"));
assert(a2Refresh.includes("function public.pick_fresh_multiplayer_answer"));
assert(a2Refresh.includes("limit 24"));
for(const len of [4,5,6]){
  const additions=[...a2SupplementBlock.matchAll(/\((4|5|6),'([^']+)'\)/g)].filter(m=>Number(m[1])===len).map(m=>m[2]);
  assert.strictEqual(additions.length,answersA2[String(len)].length-answers[String(len)].length,`A2 ${len} supplement sayısı`);
  const expected=new Set([...answers[String(len)],...additions]);
  assert.deepStrictEqual(expected,new Set(answersA2[String(len)]),`A2 ${len} frontend/backend eşleşmesi`);
}

for(const table of ["quick_match_queue","bot_matches","bot_match_secrets","bot_match_guesses"]){
  assert(quickBot.includes(`create table if not exists public.${table}`),table);
}
for(const fn of ["enter_quick_match","poll_quick_match","cancel_quick_match","create_bot_match","advance_bot_match","submit_bot_match_guess","create_bot_rematch"]){
  assert(quickBot.includes(`function public.${fn}`),fn);
}
assert(quickBot.includes("pg_advisory_xact_lock"),"quick match bucket race lock eksik");
assert(quickBot.includes("order by abs(q.performance_score-my_score),q.joined_at"),"performans yakınlığı sıralaması eksik");
assert(quickBot.includes("revoke all on public.bot_match_secrets from anon, authenticated"));
assert(!/grant\s+select\s+on\s+public\.bot_match_secrets/i.test(quickBot));
assert(quickBot.includes("when 'efe' then 5 + floor(random()*5)"));
assert(quickBot.includes("when 'atlas' then 12 + floor(random()*9)"));

assert(seed.includes("(5,'RÜŞEN')"));
assert(!seed.includes("('A1',5,'RÜŞEN')"));

console.log("✓ Canlı maç schema güvenliği + kelime seed eşleşmesi");
