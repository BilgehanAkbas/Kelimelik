const fs=require("fs");
const path=require("path");
const assert=require("assert");
const ROOT=path.resolve(__dirname,"..");
const sql=fs.readFileSync(path.join(ROOT,"supabase","migrations","20260817_027_bot_accuracy_progression.sql"),"utf8");

assert(sql.includes("create or replace function public.pick_bot_decoy"));
assert(sql.includes("lower(p_bot_key)='efe'"));
assert(sql.includes("lower(p_bot_key)='defne'"));
assert(sql.includes("bot_attempt_no-1"),"Efe ilk tahminde 0 toplam yeşil+sarıdan başlamalı");
assert(sql.includes("greatest(max_present,bot_attempt_no)"),"Defne ilk tahminde 1 toplam yeşil+sarıdan başlamalı");
assert(sql.includes("used.guess_word=w.word"),"Bot aynı kelimeyi tekrar etmemeli");
assert(sql.includes("prior.feedback->'pattern'"),"Klasik geri bildirim tutarlılığı korunmalı");
assert(sql.includes("prior.feedback->>'green'"),"Kelimelik geri bildirim tutarlılığı korunmalı");
assert(sql.includes("order by (\n      coalesce((public.live_feedback(w.word,p_answer)->>'green')::integer,0)"),"Hedef havuz biterse en az bilgi veren tutarlı aday seçilmeli");
assert.strictEqual((sql.match(/\$\$/g)||[]).length%2,0,"SQL $$ delimiter dengesiz");
console.log("✓ Efe 0'dan, Defne 1'den başlayan bot doğruluk ilerlemesi smoke testi");
