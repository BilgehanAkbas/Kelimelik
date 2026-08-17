const fs=require("fs");
const path=require("path");
const assert=require("assert");
const ROOT=path.resolve(__dirname,"..");
const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");

for(const forbidden of ["Online V1","Online kurulum gerekli","Örn. Bilgehan","2. aşama"]){
  assert(!app.includes(forbidden),`${forbidden} app.js içinde kalmamalı`);
  assert(!css.includes(forbidden),`${forbidden} style.css içinde kalmamalı`);
}
assert(app.includes("Online oyunlar için önce bir takma ad seç."));
assert(app.includes('backTo:showNewGameSelector'));
assert(!app.includes('id="profileSetupBackBtn"'));
assert(!app.includes('id="multiplayerBackBtn"'));
assert(app.includes("Çevrimiçi Oyun Henüz Etkin Değil"));

const requiredStart=app.indexOf("function showOnlineSetupRequired");
const requiredEnd=app.indexOf("function showFriendLiveSetup");
assert(requiredStart>=0 && requiredEnd>requiredStart);
const requiredSection=app.slice(requiredStart,requiredEnd);
assert(!/backend|Supabase|publishable|service_role/i.test(requiredSection));

const menuStart=app.indexOf("function showMultiplayerMenu");
const menuEnd=app.indexOf("function showNewGameSelector");
assert(menuStart>=0 && menuEnd>menuStart);
const menuSection=app.slice(menuStart,menuEnd);
assert(!/backend|Online V1|2\. aşama|Online kurulum gerekli/i.test(menuSection));


assert(app.includes('function botNormalBoardHTML'));
assert(app.includes('function botNormalKeyboardHTML'));
assert(app.includes('state.matchKind==="bot"'));
assert(app.includes('class="board bot-game-board'));
assert(app.includes('class="keyboard bot-normal-keyboard'));
assert(css.includes('.bot-normal-shell'));
assert(app.includes('function liveCountdownPhase'));
assert(app.includes('label:"MAÇ BAŞLASIN!"'));
assert(app.includes('class="bot-dual-grid"'));
assert(app.includes('botNormalBoardHTML(state,opp)'));
assert(css.includes('.bot-dual-grid'));
assert(css.includes('.live-countdown.is-go'));
assert(css.includes('.bot-game-board'));
assert(css.includes('.bot-keyboard-shell'));
assert(css.includes('.bot-normal-head{'));
assert(css.includes('padding:0 72px 0 2px'));
assert(css.includes('@media(min-width:761px) and (max-height:780px)'));
assert(css.includes('--s:clamp(24px,min(2.8vw,4.15vh),34px)'));
assert(css.includes('.bot-normal-keyboard .key{'));
assert(css.includes('/* v1.2.27 — Bot Kelimelik klavyesi: normal oyunla aynı yatay aksiyon hizası */'));
assert(css.includes('flex-direction:row!important'));
assert(css.includes('justify-content:center!important'));
assert(css.includes('position:static!important'));

assert(app.includes("Özel oda oluştur veya 6 haneli oda koduyla katıl."));
assert(app.includes('id="quickElapsed"'));
assert(app.includes('if(!root.querySelector(".quick-waiting-card"))'));
assert(css.includes(".quick-search-ring::before"));
assert(css.includes(".quick-search-time strong"));


// v1.2.33: online tahta tek oyunculu Klasik kutu ölçüsünü/animasyonlarını kullanır,
// hızlı emoji tıklamaları sessizce sınırlanır ve biten maç sonucu cevabı gösterir.
assert(css.includes('--live-s:45px'));
assert(css.includes('grid-template-columns:repeat(var(--live-cols),var(--live-s))'));
assert(css.includes('width:var(--live-s)'));
assert(css.includes('height:var(--live-s)'));
assert(css.includes('.live-result-answer'));
assert(app.includes('class="live-result-card live-result-screen"'));
assert(app.includes('const answer=String(state.answerWord||"")'));
assert(app.includes('answerWord:state.answerWord||null'));
assert(app.includes('reactionCooldownUntil:0'));
assert(app.includes('session.reactionCooldownUntil=now+1150'));
assert(app.includes('/Çok hızlı tepki|çok fazla istek|rate limit/i'));
assert((app.match(/if\(state\.status==="ended" \|\| state\.status==="cancelled"\)/g)||[]).length>=2);

console.log("✓ online UI cleanup, 3-2-1 başlangıç sahnesi, çift tahta, sade navigasyon ve bot görünümü");
