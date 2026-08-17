const fs=require("fs");
const path=require("path");
const assert=require("assert");
const ROOT=path.resolve(__dirname,"..");
const sql=fs.readFileSync(path.join(ROOT,"supabase","migrations","20260817_028_bot_logic_rebalance.sql"),"utf8");

assert(sql.includes("create or replace function public.pick_bot_decoy"));
assert(sql.includes("create or replace function public.create_bot_match"));
assert(sql.includes("create or replace function public.advance_bot_match"));
assert(sql.includes("create or replace function public.bot_delay_seconds"));

// Knowledge must never regress.
assert((sql.match(/s\.present_count>=max_present/g)||[]).length>=2,"green+yellow floor her seçim yolunda zorunlu olmalı");
assert((sql.match(/s\.green_count>=max_green/g)||[]).length>=2,"green floor her seçim yolunda zorunlu olmalı");

// Distinct learning curves.
assert(sql.includes("when 'efe' then least(p_length-1,greatest(max_present,bot_attempt_no/2))"));
assert(sql.includes("else least(p_length-1,greatest(max_present,bot_attempt_no))"));
assert(sql.includes("when 'atlas' then least(p_length-1,greatest(max_present,bot_attempt_no+1))"));
assert(sql.includes("when 'efe' then max_green"));
assert(sql.includes("when 'atlas' then least(target_present,greatest(max_green,bot_attempt_no))"));

// No-repeat and rational fallback behavior.
assert(sql.includes("used.guess_word=w.word"),"bot aynı tahmini tekrar etmemeli");
assert(sql.includes("prior.feedback->'pattern'"),"Classic önceki pattern bilgisi korunmalı");
assert(sql.includes("jsonb_array_elements_text(prior.feedback->'pattern')"),"Classic fallback yeşil konumları korumalı");
assert(sql.includes("chosen:=p_answer"),"güvenli decoy kalmazsa bot unutmak yerine çözmeli");
assert(sql.includes("if guess is null then guess:=secret; end if;"),"advance_bot_match rastgele gerileme fallback'i kullanmamalı");
assert(!sql.includes("if guess is null then\n      select w.word into guess"),"advance_bot_match random fallback içermemeli");

// Difficulty tiers.
assert(sql.includes("fail_roll<0.45"));
assert(sql.includes("fail_roll<0.15"));
assert(sql.includes("fail_roll<0.04"));
assert(sql.includes("target_low:=greatest(4,attempts-2)"));
assert(sql.includes("target_low:=greatest(3,attempts-4)"));
assert(sql.includes("target_low:=2"));

assert.strictEqual((sql.match(/\$\$/g)||[]).length%2,0,"SQL $$ delimiter dengesiz");
console.log("✓ Bot mantığı: monoton bilgi, farklı güç profilleri ve güvenli fallback smoke testi");
