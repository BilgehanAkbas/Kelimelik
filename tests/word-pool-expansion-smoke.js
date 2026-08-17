const fs=require("fs");
const path=require("path");
const vm=require("vm");
const assert=require("assert");

const ROOT=path.resolve(__dirname,"..");
const dataCode=fs.readFileSync(path.join(ROOT,"src/js/word-pools.js"),"utf8");
const context={window:{}};
vm.createContext(context);
vm.runInContext(dataCode,context);

const words=context.window.KELIMELIK_WORD_POOLS;
const answers=context.window.KELIMELIK_ANSWER_POOLS;
const daily=context.window.KELIMELIK_DAILY_SERIES;
assert.deepStrictEqual([words["4"].length,words["5"].length,words["6"].length],[2215,5851,6288]);
assert.strictEqual(words["4"].length+words["5"].length+words["6"].length,14354);

for(const word of ["AKIŞ","ATIŞ","ANKA","BANA","ARICI","ARTIŞ","BAĞLI","BİLME","AKILCI","AMAÇLI","ANILMA","ALANYA","EFES","AYLİN","ZEHRA","TRUVA","PRİENE","PATARA"]){
  assert(words[String([...word].length)].includes(word),`${word} geniş sözlükte yok`);
}

assert.deepStrictEqual([answers.A1["4"].length,answers.A1["5"].length,answers.A1["6"].length],[156,659,114]);
assert.deepStrictEqual([answers.A2["4"].length,answers.A2["5"].length,answers.A2["6"].length],[596,790,195]);
for(const length of [4,5,6]){
  const a1=new Set(answers.A1[String(length)]);
  const a2=new Set(answers.A2[String(length)]);
  for(const word of a1)assert(a2.has(word),`A1 cevabı A2'de yok: ${word}`);
  for(const word of a2)assert(words[String(length)].includes(word),`A2 cevabı guess pool'da yok: ${word}`);
}
for(const word of ["BİNGO","BİYOM","FOTON","MARŞAL"]){
  const length=String([...word].length);
  assert(words[length].includes(word),`${word} yeni guess supplementte yok`);
  assert(!answers.A2[length].includes(word),`${word} guess-only olmalı`);
}
assert.strictEqual(daily[0].version,"D1");
assert.strictEqual(daily[0].start,"2026-08-14");

const sql=fs.readFileSync(path.join(ROOT,"supabase","migrations","20260816_007_word_pool_expansion.sql"),"utf8");
const expansionRows=[...sql.matchAll(/\((4|5|6),'([^']+)'\)/g)].map(m=>({length:Number(m[1]),word:m[2]}));
assert.strictEqual(expansionRows.length,2810);
assert.strictEqual(expansionRows.filter(x=>x.length===4).length,205);
assert.strictEqual(expansionRows.filter(x=>x.length===5).length,856);
assert.strictEqual(expansionRows.filter(x=>x.length===6).length,1749);
assert.strictEqual(new Set(expansionRows.map(x=>`${x.length}:${x.word}`)).size,2810);
for(const word of ["AKIŞ","ARTIŞ","AKILCI"]){
  assert(sql.includes(`'${word}'`),`${word} backend expansion migrationında yok`);
}
assert(!sql.includes("insert into public.multiplayer_answer_words"));
assert(sql.includes("on conflict (length,word) do nothing"));
assert(sql.includes("from public.multiplayer_answer_words w"));
assert(sql.includes("w.answer_version='A1'"));
assert(sql.includes("revoke all on function public.pick_bot_decoy(uuid,text,integer,text) from public, anon, authenticated"));


const properSql=fs.readFileSync(path.join(ROOT,"supabase","migrations","20260816_011_proper_name_supplement.sql"),"utf8");
const properRows=[...properSql.matchAll(/\((4|5|6),'([^']+)'\)/g)].map(m=>({length:Number(m[1]),word:m[2]}));
assert.strictEqual(properRows.length,136);
assert.strictEqual(properRows.filter(x=>x.length===4).length,22);
assert.strictEqual(properRows.filter(x=>x.length===5).length,62);
assert.strictEqual(properRows.filter(x=>x.length===6).length,52);
for(const word of ["EFES","AYLİN","ZEHRA","TRUVA","PRİENE","PATARA"]){
  assert(properSql.includes(`'${word}'`),`${word} proper-name migrationında yok`);
}
assert(!properSql.includes("multiplayer_answer_words"));
assert(properSql.includes("on conflict (length,word) do nothing"));

const a2Sql=fs.readFileSync(path.join(ROOT,"supabase","migrations","20260816_021_answer_pool_a2_refresh.sql"),"utf8");
assert(a2Sql.includes("select 'A2',length,word,enabled"));
assert(a2Sql.includes("where answer_version='A1'"));
assert(a2Sql.includes("function public.pick_fresh_multiplayer_answer"));
assert(a2Sql.includes("limit 24"));
assert(a2Sql.includes("answer_version='A2'"));
for(const word of ["BİNGO","BİYOM","FOTON","MARŞAL"]){
  assert(a2Sql.includes(`'${word}'`),`${word} migration 021'de yok`);
}

const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
assert(app.includes("CORE.possibleSecrets(ANSWER_WORDS,completed)"));
assert(app.includes('const CURRENT_ANSWER_VERSION="A3"'));
assert(app.includes("const RECENT_ANSWER_WINDOW=24"));

console.log("✓ geniş guess pool, frozen A1/D1, A2 cevap havuzu ve tekrar koruması");
