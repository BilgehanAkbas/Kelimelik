const fs=require("fs");
const path=require("path");
const assert=require("assert");
const ROOT=path.resolve(__dirname,"..");
const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
const online=fs.readFileSync(path.join(ROOT,"src/js/online.js"),"utf8");
const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
const liveSql=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260815_002_live_multiplayer.sql"),"utf8");
const botSql=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260815_004_quick_match_bot.sql"),"utf8");
const fairness=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260816_014_bot_fairness_live_invalid_feedback.sql"),"utf8");

// Bir oyuncunun hakkı bitti diye insan-vs-insan maçı bitmez; iki taraf da bitirirse beraberlik olur.
assert(liveSql.includes("opponent.attempts_used>=m.attempt_limit"));
assert(liveSql.includes("winner_id=null,end_reason='draw'"));

// Bot maçında da insanın hakkı dolunca bot otomatik galip ilan edilmez.
assert(botSql.includes("next_attempt>=m.attempt_limit and m.bot_attempts_used>=m.attempt_limit and m.bot_solved_at is null"));
assert(botSql.includes("next_attempt>=m.attempt_limit and m.player_attempts_used>=m.attempt_limit and m.player_solved_at is null"));

// Efe/Defne/Atlas'ın tamamında gerçek bir çözememe olasılığı bulunur.
assert(fairness.includes("target:=attempts+1"));
assert(fairness.includes("clean_bot='efe' and fail_roll<0.28"));
assert(fairness.includes("clean_bot='defne' and fail_roll<0.15"));
assert(fairness.includes("clean_bot='atlas' and fail_roll<0.08"));

// Online geçersiz kelime tek oyunculu kırmızı sallanma geri bildirimini yeniden kullanır.
assert(app.includes("invalidInputUntil"));
assert(app.includes("function animateLiveInvalidGuess()"));
assert(app.includes("Bu kelime geçerli değil. Tahmin hakkın kullanılmadı."));
assert(app.includes("Tahmin hakkın bitti · Rakibin tamamlaması bekleniyor"));
assert(css.includes(".live-tile.invalid-word"));
assert(css.includes("animation:invalidWordShakeRed"));
assert(online.includes('"Kelime havuzunda yok"'));

// Online yazma/gönderme animasyonları tek oyunculu animasyon sınıflarını kullanır.
assert(app.includes("function animateLiveTileEntry("));
assert(app.includes("function animateLiveSubmittedRow("));
assert(app.includes('requestAnimationFrame(()=>animateLiveTileEntry("self",row,col))'));
assert(app.includes("newGuessRows.forEach(item=>animateLiveSubmittedRow"));
assert(css.includes(".tile.tile-pop,.live-tile.tile-pop"));
assert(css.includes(".tile.tile-submit,.live-tile.tile-submit"));
assert(css.includes(".counter.counter-reveal,.live-counters b.counter-reveal"));

// Bot için sürekli "düşünüyor" bannerı yok; insan rakip durumu korunur.
assert(app.includes('if(opp?.isBot)return "";'));
assert(!app.includes('${opp.nickname||"Bot"} düşünüyor…'));

console.log("✓ Online hak bitişi, bot çözememe ihtimali ve geçersiz-kelime animasyonu regresyon testi");
