const fs=require("fs");
const path=require("path");
const assert=require("assert");
const ROOT=path.resolve(__dirname,"..");

const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
const sql=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260818_031_bot_candidate_reasoning.sql"),"utf8");

assert(app.includes("İkinci oyuncu katılınca oyun 3 saniye sonra otomatik başlayacak."));
assert(!app.includes("İkinci oyuncu katılınca 3-2-1 geri sayımı otomatik başlayacak."));

assert(sql.includes("candidate_count integer := 0"));
assert(sql.includes("candidate_cap integer := 1"));
assert(sql.includes("candidate_count between 1 and candidate_cap"));
assert(sql.includes("candidate_cap:=1")); // Efe
assert(sql.includes("candidate_cap:=2")); // Defne
assert(sql.includes("candidate_cap:=3")); // Atlas
assert(sql.includes("solve_floor:=greatest(3,m.word_length-1)"));
assert(sql.includes("solve_floor:=greatest(3,m.word_length-2)"));
assert(sql.includes("Pick from what the bot can logically still believe"));
assert(!sql.includes("guess:=secret"));
assert(sql.includes("set bot_next_guess_at=null"));
assert(sql.includes("values(match_id,secret_version,secret)"));

console.log("✓ Oda 3 saniye metni ve aday-kümesi tabanlı bot mantığı smoke testi");
