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
const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
const sql=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260817_022_word_pool_quality_a3.sql"),"utf8");
const tdkSql=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260817_023_tdk_canonical_word_pool_a3.sql"),"utf8");

assert.deepStrictEqual([words["4"].length,words["5"].length,words["6"].length],[2215,5851,6288]);
assert.strictEqual(words["4"].length+words["5"].length+words["6"].length,14354);

for(const word of ["BİLİ","BİŞİ"]){
  assert(words["4"].includes(word),`${word} TDK kanonik final guess pool'da olmalı`);
  assert(sql.includes(`(4,'${word}')`),`${word} eski kalite migrationındaki temizleme kaydı yok`);
}
assert(!words["4"].includes("KEDI"),"KEDI yanlış yazımı final guess pool'da olmamalı");
assert(sql.includes("(4,'KEDI')"),"KEDI backend temizleme migrationında yok");

for(const word of ["AURA","BAYT","BLOG","URFA"]){
  assert(words["4"].includes(word),`${word} 4 harf guess pool'da yok`);
  assert(sql.includes(`(4,'${word}')`),`${word} backend guess supplementte yok`);
}
for(const word of ["RAYLI","REFLÜ","REMZİ","RONDO","RUMEN","ÜNVAN"]){
  assert(words["5"].includes(word),`${word} 5 harf guess pool'da yok`);
  assert(sql.includes(`(5,'${word}')`),`${word} backend guess supplementte yok`);
}

assert.deepStrictEqual([pools.A3["4"].length,pools.A3["5"].length,pools.A3["6"].length],[591,787,189]);
const blockedAnswers=["GÖLÜ","ARANAN","EKRANI","EVDEKİ","ÇABUCA","İLERDE"];
for(const word of blockedAnswers){
  const length=String([...word].length);
  assert(!pools.A3[length].includes(word),`${word} A3 answer pool'da kalmış`);
  assert(sql.includes(`'${word}'`),`${word} backend A3 filtresinde yok`);
}
assert(!pools.A3["4"].includes("BÖRÜ"),"BÖRÜ TDK kanonik A3 havuzunda olmamalı");
assert(sql.includes("values ('A3',4,'BÖRÜ',true)"),"022 kalite migrationındaki tarihsel BÖRÜ kaydı korunmalı");
assert(tdkSql.includes("extensions.http_get("));
assert(tdkSql.includes("delete from public.multiplayer_guess_words"));
assert(tdkSql.includes("insert into public.multiplayer_guess_words"));

assert(app.includes('const CURRENT_ANSWER_VERSION="A3"'));
assert(app.includes("const safeFallback=ANSWER_WORDS.filter"));
assert(app.includes("const nonSecret=ANSWER_WORDS.filter"));
assert(!app.includes("const safeFallback=WORDS.filter"));
assert(!app.includes("const nonSecret=WORDS.filter"));

assert(sql.includes("answer_version='A3'"));
assert(sql.includes("new.answer_version:='A3'"));
assert(sql.includes("drop trigger if exists trg_live_secret_fresh_a2"));
assert(sql.includes("drop trigger if exists trg_bot_secret_fresh_a2"));
assert(sql.includes("create trigger trg_live_secret_fresh_a3"));
assert(sql.includes("create trigger trg_bot_secret_fresh_a3"));

console.log("✓ v1.2.32 TDK kanonik final havuzu, A3 answer quality ve hint güvenliği");
