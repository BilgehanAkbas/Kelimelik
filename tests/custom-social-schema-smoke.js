const fs=require("fs");
const path=require("path");
const assert=require("assert");
const ROOT=path.resolve(__dirname,"..");
const sql=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260815_005_custom_puzzle_social.sql"),"utf8");

for(const table of ["custom_puzzles","custom_puzzle_secrets","custom_puzzle_plays","custom_puzzle_guesses"]){
  assert(sql.includes(`create table if not exists public.${table}`),table);
}
for(const fn of ["create_custom_puzzle","get_custom_puzzle_state","submit_custom_puzzle_guess","use_custom_puzzle_hint","get_head_to_head"]){
  assert(sql.includes(`function public.${fn}`),fn);
}
assert(sql.includes("puzzle_code ~ '^[A-Z2-9]{7}$'"));
assert(sql.includes("interval '90 days'"));
assert(sql.includes("public.multiplayer_guess_words"));
assert(sql.includes("hint_used boolean not null default false"));
assert(sql.includes("(public.live_feedback(aw.word,secret)->>'green')::integer>=best_green"));
assert(sql.includes("public_fb:=case when p.mode='kelimelik' then fb-'pattern' else fb end"));
assert(sql.includes("revoke all on public.custom_puzzle_secrets from anon, authenticated"));
assert(!/grant\s+select\s+on\s+public\.custom_puzzle_secrets/i.test(sql));
assert(sql.includes("m.status='ended'"));
assert(sql.includes("limit 5"));
assert(!sql.includes("email"));
console.log("✓ Özel bulmaca secret güvenliği + ikili geçmiş schema smoke testi");
