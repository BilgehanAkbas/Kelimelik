const fs=require("fs");
const path=require("path");
const assert=require("assert");
const ROOT=path.resolve(__dirname,"..");
const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
const mobile=fs.readFileSync(path.join(ROOT,"src/js/mobile-fixes.js"),"utf8");

assert(app.includes("Array.from(modalBody.children||[])"));
assert(app.includes('modalBody.querySelector?.(".live-match-head h2")'));
assert(!app.includes('const heading=modalBody.querySelector?.("h2")'));
assert(!mobile.includes("alignModalCloseButton=function"));

assert(app.includes("function pinLiveModalCloseButton"));
assert(app.includes('modal.classList.add("live-close-pinned")'));
assert(app.includes('window.visualViewport.addEventListener("scroll",syncLiveCloseToViewport)'));
const mobileCss=fs.readFileSync(path.join(ROOT,"src/css/mobile-fixes.css"),"utf8");
assert(mobileCss.includes('.live-match-modal.live-close-pinned .modal-close'));
assert(mobileCss.includes('position:fixed!important'));

// Pre-game online headers must not show the fake 00:00 timer.
const botCountdown=app.slice(app.indexOf('function renderBotMatchNormal'),app.indexOf('function renderLiveMatch'));
assert(!/status===\"countdown\"[\s\S]*?live-match-time[\s\S]*?00:00/.test(botCountdown));
const liveRender=app.slice(app.indexOf('function renderLiveMatch'),app.indexOf('function liveTileElement'));
assert(!/status===\"countdown\"[\s\S]*?live-match-time[\s\S]*?00:00/.test(liveRender));
assert(liveRender.includes('${status==="active"?`<div class="live-match-time">${timer}</div>`:""}'));

// Quick-match still unlocks bot after 12 sec internally but shows no visible stopwatch.
assert(app.includes("const botReady=elapsed>=12"));
assert(app.includes('aria-label="Rakip aranıyor"'));
assert(!app.includes('id="quickElapsed"'));
console.log("✓ Mobil X anchoring ve online giriş ekranı sayaç temizliği smoke testi");
