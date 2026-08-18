const fs=require("fs");
const path=require("path");
const assert=require("assert");
const ROOT=path.resolve(__dirname,"..");
const sql=fs.readFileSync(path.join(ROOT,"supabase","migrations","20260818_030_bot_solve_guard.sql"),"utf8");

assert(sql.includes("create or replace function public.create_bot_match"));
assert(sql.includes("create or replace function public.pick_bot_decoy"));
assert(sql.includes("create or replace function public.advance_bot_match"));

// Defne is slightly weaker than the previous 15% / 4..6 profile.
assert(sql.includes("fail_roll<0.20"));
assert(sql.includes("target_low:=greatest(4,attempts-3)"));
assert(sql.includes("target_high:=least(attempts,7)"));

// No direct target-turn solve without visible information.
assert(sql.includes("solve_floor:=case lower(m.bot_key)"));
assert(sql.includes("else greatest(3,m.word_length-1)")); // Defne: 6 harf => 5 bilgi
assert(sql.includes("when 'atlas' then greatest(2,m.word_length-2)"));
assert(sql.includes("when 'efe' then greatest(2,m.word_length-3)"));
assert(sql.includes("and max_present>=solve_floor"));
assert(sql.includes("next_attempt>=m.bot_target_attempt"));

// Smooth visible progression and no answer-as-decoy fallback.
assert(sql.includes("max_step_present"));
assert(sql.includes("max_present + case when bot_key='atlas' then 2 else 1 end"));
assert((sql.match(/s\.present_count>=max_present/g)||[]).length>=3);
assert(!sql.includes("chosen:=p_answer"));
assert(sql.includes("if guess is null then"));
assert(!sql.includes("if guess is null then guess:=secret"));
assert.strictEqual((sql.match(/\$\$/g)||[]).length%2,0,"SQL $$ delimiter dengesiz");
console.log("✓ Bot solve guard: düşük bilgiden cevaba sıçrama engeli ve Defne nerfi smoke testi");
