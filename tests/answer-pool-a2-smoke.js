const fs=require("fs");
const path=require("path");
const vm=require("vm");
const assert=require("assert");

const ROOT=path.resolve(__dirname,"..");
const ctx={window:{}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT,"src/js/word-pools.js"),"utf8"),ctx,{filename:"word-pools.js"});

const words=ctx.window.KELIMELIK_WORD_POOLS;
const pools=ctx.window.KELIMELIK_ANSWER_POOLS;
const daily=ctx.window.KELIMELIK_DAILY_SERIES;

assert.deepStrictEqual([pools.A1["4"].length,pools.A1["5"].length,pools.A1["6"].length],[156,659,114]);
assert.deepStrictEqual([pools.A2["4"].length,pools.A2["5"].length,pools.A2["6"].length],[596,790,195]);
assert.strictEqual(pools.A2["4"].length+pools.A2["5"].length+pools.A2["6"].length,1581);

for(const length of [4,5,6]){
  const guessSet=new Set(words[String(length)]);
  const a1=new Set(pools.A1[String(length)]);
  const a2=new Set(pools.A2[String(length)]);
  for(const word of a1)assert(a2.has(word),`A1 ${length} kelimesi A2'de yok: ${word}`);
  for(const word of a2)assert(guessSet.has(word),`A2 ${length} kelimesi guess pool'da yok: ${word}`);
}

for(const word of ["BİNGO","BİYOM","FOTON","MARŞAL"]){
  const length=String([...word].length);
  assert(words[length].includes(word),`${word} guess pool'da yok`);
  assert(!pools.A2[length].includes(word),`${word} guess-only kalmalı`);
}


assert.deepStrictEqual([pools.A3["4"].length,pools.A3["5"].length,pools.A3["6"].length],[591,787,189]);
for(const word of ["GÖLÜ","ARANAN","EKRANI","EVDEKİ","ÇABUCA","İLERDE"]){
  const length=String([...word].length);
  assert(!pools.A3[length].includes(word),`${word} A3'te olmamalı`);
}
assert(!pools.A3["4"].includes("BÖRÜ"));

assert.strictEqual(daily[0].version,"D1");
assert.strictEqual(daily[0].start,"2026-08-14");

const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
assert(app.includes('const CURRENT_ANSWER_VERSION="A3"'));
assert(app.includes('const RECENT_ANSWERS_KEY="kelimelik-recent-answers-v1"'));
assert(app.includes("const RECENT_ANSWER_WINDOW=24"));
assert(app.includes("function chooseFreshRandomSecret"));
assert(app.includes("rememberRecentAnswer(secretWord,COLS)"));

const sql=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260816_021_answer_pool_a2_refresh.sql"),"utf8");
assert(sql.includes("select 'A2',length,word,enabled"));
assert(sql.includes("where answer_version='A1'"));
assert(sql.includes("function public.pick_fresh_multiplayer_answer"));
assert(sql.includes("limit 24"));
assert(sql.includes("aw.answer_version='A2'"));
assert(sql.includes("function public.enforce_fresh_live_answer_a2"));
assert(sql.includes("function public.enforce_fresh_bot_answer_a2"));
assert(sql.includes("create trigger trg_live_secret_fresh_a2"));
assert(sql.includes("create trigger trg_bot_secret_fresh_a2"));
assert(sql.includes("new.answer_version:='A2'"));
assert(sql.includes("revoke all on function public.pick_fresh_multiplayer_answer(integer,uuid[],text) from public, anon, authenticated"));
assert(sql.includes("where aw.answer_version='A1'"),"A1 backend fallback korunmalı");
assert(sql.includes("and (p_exclude is null or aw.word<>p_exclude)"),"rövanş explicit exclude eksik");

const supplementBlock=sql.split("-- Frekans/yaygınlık odaklı kontrollü A2 cevap takviyesi.")[1].split(") as v(length,word)")[0];
const rows=[...supplementBlock.matchAll(/\((4|5|6),'([^']+)'\)/g)].map(m=>({length:Number(m[1]),word:m[2]}));
assert.strictEqual(rows.length,652);
assert.strictEqual(rows.filter(x=>x.length===4).length,440);
assert.strictEqual(rows.filter(x=>x.length===5).length,131);
assert.strictEqual(rows.filter(x=>x.length===6).length,81);

console.log("✓ A2 cevap havuzu, frozen A1/D1 ve son-24 cevap tekrar koruması");
