const fs=require("fs");
const path=require("path");
const vm=require("vm");
const assert=require("assert");

const ROOT=path.resolve(__dirname,"..");
const core=require(path.join(ROOT,"src/js/game-core.js"));

let passed=0;
function test(name,fn){
  try{
    fn();
    passed++;
    console.log("✓",name);
  }catch(error){
    console.error("✗",name);
    console.error(error.stack||error);
    process.exitCode=1;
  }
}

const dataCode=fs.readFileSync(path.join(ROOT,"src/js/word-pools.js"),"utf8");
const context={window:{}};
vm.createContext(context);
vm.runInContext(dataCode,context);

const WORDS=context.window.KELIMELIK_WORD_POOLS;
const ANSWERS=context.window.KELIMELIK_ANSWER_POOLS;
const DAILY=context.window.KELIMELIK_DAILY_SERIES;
const ALLOWED=new Set([..."ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ"]);

test("4/5/6 tahmin havuzları yapısal olarak geçerli",()=>{
  for(const length of [4,5,6]){
    const list=WORDS[String(length)];
    assert(Array.isArray(list) && list.length>100);
    assert.strictEqual(list.length,new Set(list).size);
    for(const word of list){
      assert.strictEqual(word.length,length,word);
      for(const ch of word)assert(ALLOWED.has(ch),word);
    }
  }
});



test("v1.2.14 geniş tahmin havuzu ve özel isim takviyesi doğru",()=>{
  assert.strictEqual(WORDS["4"].length,2215);
  assert.strictEqual(WORDS["5"].length,5851);
  assert.strictEqual(WORDS["6"].length,6288);
  assert.strictEqual(WORDS["4"].length+WORDS["5"].length+WORDS["6"].length,14354);

  ["AKIŞ","ATIŞ","ANKA","BANA"].forEach(word=>assert(WORDS["4"].includes(word),word));
  ["ARICI","ARTIŞ","BAĞLI","BİLME"].forEach(word=>assert(WORDS["5"].includes(word),word));
  ["AKILCI","AMAÇLI","ANILMA","ALANYA"].forEach(word=>assert(WORDS["6"].includes(word),word));
  ["EFES","ASLI","RANA"].forEach(word=>assert(WORDS["4"].includes(word),word));
  ["AYLİN","ZEHRA","TRUVA","MİLET"].forEach(word=>assert(WORDS["5"].includes(word),word));
  ["PRİENE","PATARA","FRANSA","KANADA"].forEach(word=>assert(WORDS["6"].includes(word),word));
});

test("A1 cevap sayıları geniş guess pool sonrası donmuş kalıyor",()=>{
  assert.strictEqual(ANSWERS.A1["4"].length,156);
  assert.strictEqual(ANSWERS.A1["5"].length,659);
  assert.strictEqual(ANSWERS.A1["6"].length,114);
});

test("A2 cevap havuzu genişletilmiş ve A1'i koruyor",()=>{
  assert.strictEqual(ANSWERS.A2["4"].length,596);
  assert.strictEqual(ANSWERS.A2["5"].length,790);
  assert.strictEqual(ANSWERS.A2["6"].length,195);
  assert.strictEqual(ANSWERS.A2["4"].length+ANSWERS.A2["5"].length+ANSWERS.A2["6"].length,1581);

  for(const length of [4,5,6]){
    const a1=new Set(ANSWERS.A1[String(length)]);
    const a2=new Set(ANSWERS.A2[String(length)]);
    const valid=new Set(WORDS[String(length)]);
    for(const word of a1)assert(a2.has(word),`A1 cevabı A2'de yok: ${word}`);
    for(const word of a2)assert(valid.has(word),`A2 cevabı tahmin havuzunda yok: ${word}`);
  }
});


test("A3 yeni oyun cevaplarını kalite filtresinden geçiriyor",()=>{
  assert.strictEqual(ANSWERS.A3["4"].length,591);
  assert.strictEqual(ANSWERS.A3["5"].length,787);
  assert.strictEqual(ANSWERS.A3["6"].length,189);
  assert.strictEqual(ANSWERS.A3["4"].length+ANSWERS.A3["5"].length+ANSWERS.A3["6"].length,1567);

  const blocked=["ARANAN","ÇABUCA","ÇITIR","DART","DIŞLI","EKRANI","EVDEKİ","GÖLÜ","GUAŞ","İLERDE","İPUÇLU","KAJU","MEGA","NELER"];
  for(const word of blocked){
    const length=String([...word].length);
    assert(!ANSWERS.A3[length].includes(word),`${word} A3 cevap havuzunda kalmış`);
  }
  assert(!ANSWERS.A3["4"].includes("BÖRÜ"),"BÖRÜ TDK A3 havuzunda olmamalı");
  for(const length of [4,5,6]){
    const valid=new Set(WORDS[String(length)]);
    for(const word of ANSWERS.A3[String(length)]) assert(valid.has(word),`A3 cevabı tahmin havuzunda yok: ${word}`);
  }
});

test("v1.2.32 tahmin havuzu audit ekleme/silmeleri doğru",()=>{
  for(const word of ["AURA","BAYT","BLOG","URFA"]){
    assert(WORDS["4"].includes(word),`${word} 4 harf tahmin havuzunda yok`);
  }
  for(const word of ["RAYLI","REFLÜ","REMZİ","RONDO","RUMEN","ÜNVAN"]){
    assert(WORDS["5"].includes(word),`${word} 5 harf tahmin havuzunda yok`);
  }
  for(const word of ["BİLİ","BİŞİ"]){
    assert(WORDS["4"].includes(word),`${word} TDK tahmin havuzunda yok`);
  }
  assert(!WORDS["4"].includes("KEDI"),"KEDI Türkçe karakter yazımı nedeniyle havuzda olmamalı");
});

test("A2 guess-only modern takviyeyi otomatik cevap yapmıyor",()=>{
  for(const word of ["BİNGO","BİYOM","FOTON","MARŞAL"]){
    const length=String([...word].length);
    assert(WORDS[length].includes(word),`${word} tahmin havuzunda yok`);
    assert(!ANSWERS.A2[length].includes(word),`${word} yanlışlıkla A2 cevap havuzuna girdi`);
  }
});

test("RÜŞEN ve kontrollü isim allowlist tahmin havuzunda",()=>{
  ["HALİL","OSMAN","RÜŞEN"].forEach(word=>{
    assert(WORDS["5"].includes(word),`${word} 5 harf tahmin havuzunda yok`);
  });
  ["FURKAN","MAHMUT","MEHMET","İSMAİL"].forEach(word=>{
    assert(WORDS["6"].includes(word),`${word} 6 harf tahmin havuzunda yok`);
  });
});

test("Yeni isim allowlist A1 cevap havuzuna otomatik eklenmiyor",()=>{
  const additions=["HALİL","OSMAN","RÜŞEN","FURKAN","MAHMUT","MEHMET","İSMAİL"];
  const answerSet=new Set([
    ...ANSWERS.A1["4"],
    ...ANSWERS.A1["5"],
    ...ANSWERS.A1["6"]
  ]);
  additions.forEach(word=>{
    assert(!answerSet.has(word),`${word} yanlışlıkla A1 cevap havuzuna eklendi`);
  });
});

test("A1 cevap havuzu geçerli ve tahmin havuzunun alt kümesi",()=>{
  assert(ANSWERS.A1);
  for(const length of [4,5,6]){
    const valid=new Set(WORDS[String(length)]);
    const answers=ANSWERS.A1[String(length)];
    assert(answers.length>=80);
    for(const word of answers){
      assert.strictEqual(word.length,length);
      assert(valid.has(word),`Cevap tahmin havuzunda yok: ${word}`);
    }
  }
});

test("D1 günlük havuzu 5 harfli ve donmuş tahmin havuzuyla uyumlu",()=>{
  assert.strictEqual(DAILY[0].version,"D1");
  assert.strictEqual(DAILY[0].start,"2026-08-14");
  const valid=new Set(WORDS["5"]);
  assert(DAILY[0].answers.length>=100);
  for(const word of DAILY[0].answers){
    assert.strictEqual(word.length,5);
    assert(valid.has(word));
  }
});

test("Tekrarlanan harfler iki aşamalı eşleşmede fazla sayılmıyor",()=>{
  assert.deepStrictEqual(
    core.calculateFeedback("AAAAA","KALEM"),
    {green:1,yellow:0,red:4,pattern:["red","green","red","red","red"]}
  );

  const second=core.calculateFeedback("ELALE","KALEM");
  assert.strictEqual(second.green,0);
  assert.strictEqual(second.yellow,3);
  assert.strictEqual(second.red,2);
});

test("İpucu aday filtresi gerçek cevabı koruyor",()=>{
  const words=["KALEM","KADER","KABAK","SELAM"];
  const feedback=core.calculateFeedback("KADER","KALEM");
  const candidates=core.possibleSecrets(words,[{guess:"KADER",feedback}]);
  assert(candidates.includes("KALEM"));
});

test("İpucu adayları mevcut en iyi yeşil sayısının altına düşmüyor",()=>{
  const answer="KADER";
  const candidates=["KABER","KILER","KALEM","KADER","SABER"];
  const filtered=core.filterHintWordsByGreenFloor(candidates,answer,2);

  assert(filtered.length>0);
  filtered.forEach(word=>{
    assert(core.calculateFeedback(word,answer).green>=2,`${word} yeşil tabanının altına düştü`);
  });
});

test("İpucu sıralaması deterministik",()=>{
  const a=core.scoreHintWords(["KALEM","SELAM","KADER"]);
  const b=core.scoreHintWords(["KALEM","SELAM","KADER"]);
  assert.deepStrictEqual(a,b);
});

test("Yeni oyun kodu sürüm içeriyor ve round-trip yapıyor",()=>{
  const code=core.buildGameCode(5,"ABC123","A1");
  assert.strictEqual(code,"K1-5-ABC123");
  assert.deepStrictEqual(
    core.parseGameCode(code),
    {version:"A1",length:5,seed:"ABC123",legacy:false}
  );
});

test("Eski K5-ABC123 kodları A1 olarak çalışmaya devam ediyor",()=>{
  assert.deepStrictEqual(
    core.parseGameCode("K5-ABC123"),
    {version:"A1",length:5,seed:"ABC123",legacy:true}
  );
});

test("Aynı seed + A1 her zaman aynı kelimeyi üretir",()=>{
  const one=core.chooseSeededWord(ANSWERS,"A1",5,"ABC123");
  const two=core.chooseSeededWord(ANSWERS,"A1",5,"ABC123");
  assert.strictEqual(one,two);
});

test("Günlük #1 lansman tarihinde başlıyor",()=>{
  assert.strictEqual(core.dailyPuzzleNumber("2026-08-14","2026-08-14"),1);
  assert.strictEqual(core.dailyPuzzleNumber("2026-08-15","2026-08-14"),2);
});

test("Aynı günlük tarih aynı kelimeyi üretir",()=>{
  const a=core.chooseDailyWord(DAILY,"2026-09-01","2026-08-14");
  const b=core.chooseDailyWord(DAILY,"2026-09-01","2026-08-14");
  assert.deepStrictEqual(a,b);
});

test("Yeni D2 eklense bile eski D1 tarihleri değişmez",()=>{
  const before=core.chooseDailyWord(DAILY,"2026-09-01","2026-08-14");
  const expanded=[
    ...DAILY,
    {version:"D2",start:"2027-01-01",answers:["KALEM","KADER"]}
  ];
  const after=core.chooseDailyWord(expanded,"2026-09-01","2026-08-14");
  assert.deepStrictEqual(before,after);
});

test("İstatistik kazanma / en iyi / ortalama verisini güncelliyor",()=>{
  const bucket={
    gamesPlayed:0,wins:0,currentStreak:0,maxStreak:0,
    guessDistribution:[0,0,0,0,0,0,0,0],
    totalWinningGuesses:0,bestWin:null,lastPlayedDate:null
  };
  core.updateStatBucket(bucket,true,4,{today:"2026-08-14"});
  core.updateStatBucket(bucket,true,2,{today:"2026-08-14"});
  assert.strictEqual(bucket.gamesPlayed,2);
  assert.strictEqual(bucket.wins,2);
  assert.strictEqual(bucket.totalWinningGuesses,6);
  assert.strictEqual(bucket.bestWin,2);
});

test("Günlük seri araya gün girerse sıfırlanıyor",()=>{
  const bucket={
    gamesPlayed:1,wins:1,currentStreak:1,maxStreak:1,
    guessDistribution:[1,0,0,0,0,0,0,0],
    totalWinningGuesses:1,bestWin:1,lastPlayedDate:"2026-08-12"
  };
  core.updateStatBucket(bucket,true,3,{daily:true,today:"2026-08-14"});
  assert.strictEqual(bucket.currentStreak,1);
});

test("words.js artık uygulama tarafından kullanılmıyor",()=>{
  const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
  const sw=fs.readFileSync(path.join(ROOT,"sw.js"),"utf8");

  assert(!html.includes('src="words.js"'));
  assert(!sw.includes("./words.js"));
});

test("localStorage kalıcı durum anahtarları ve save payload mevcut",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  for(const token of [
    "kelimelik-game-v18",
    "kelimelik-daily-progress-v1",
    "kelimelik-stats-v2",
    "kelimelik-settings-v1",
    "kelimelik-history-v1",
    "kelimelik-favorites-v1",
    "gameAnswerVersion",
    "gameDailyVersion"
  ]){
    assert(app.includes(token),token);
  }
});

test("HTML'deki yerel asset referansları mevcut",()=>{
  const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
  const refs=[...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(x=>x[1])
    .filter(x=>!x.startsWith("http") && !x.startsWith("mailto:") && x!=="#");

  for(const ref of refs){
    const clean=ref.replace(/^\.\//,"");
    assert(fs.existsSync(path.join(ROOT,clean)),`Eksik asset: ${clean}`);
  }
});

test("social-card.png 1200x630",()=>{
  const buffer=fs.readFileSync(path.join(ROOT,"assets","social-card.png"));
  assert.strictEqual(buffer.toString("ascii",1,4),"PNG");
  const width=buffer.readUInt32BE(16);
  const height=buffer.readUInt32BE(20);
  assert.strictEqual(width,1200);
  assert.strictEqual(height,630);
});

test("Service Worker tek sözlük + yeni assetleri cache ediyor",()=>{
  const sw=fs.readFileSync(path.join(ROOT,"sw.js"),"utf8");
  assert(sw.includes("./src/js/word-pools.js"));
  assert(sw.includes("./src/js/game-core.js"));
  assert(sw.includes("./assets/social-card.png"));
  assert(!sw.includes("./words.js"));
  assert(!sw.includes("./social-card.svg"));
});

test("Günlük numarası kullanıcı arayüzünden kaldırıldı",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(!app.includes("Günlük #${dailyPuzzleNumber()}"));
  assert(!app.includes("Günlük Bulmaca #${dailyPuzzleNumber()}"));
  assert(app.includes("Günün Bulmacası Çözüldü"));
  assert(app.includes("Günün Bulmacası Çözülmedi"));
});


test("A1 yeni ve legacy kod aynı gizli kelimeye gider",()=>{
  const legacy=core.parseGameCode("K5-ABC123");
  const current=core.parseGameCode("K1-5-ABC123");
  const a=core.chooseSeededWord(ANSWERS,legacy.version,legacy.length,legacy.seed);
  const b=core.chooseSeededWord(ANSWERS,current.version,current.length,current.seed);
  assert.strictEqual(a,b);
});

test("A1 algoritması v29 hash tarifini birebir koruyor",()=>{
  const seed="ABC123";
  const pool=ANSWERS.A1["5"];
  const expected=pool[core.hashSeed(`5:${seed}`)%pool.length];
  const actual=core.chooseSeededWord(ANSWERS,"A1",5,seed);
  assert.strictEqual(actual,expected);
});

test("8 karakter seed çekirdekte destekleniyor",()=>{
  const code=core.buildGameCode(5,"ABCDEFGH","A1");
  assert.strictEqual(code,"K1-5-ABCDEFGH");
  assert.strictEqual(code.length,13);
});

test("Gün değişimi #N -> #N+1 olarak devam ediyor",()=>{
  const before=core.chooseDailyWord(DAILY,"2026-08-14","2026-08-14");
  const after=core.chooseDailyWord(DAILY,"2026-08-15","2026-08-14");
  assert.strictEqual(after.number,before.number+1);
});

test("Türkiye gece yarısı mantığı takvim tarihi üzerinden güvenli",()=>{
  assert.strictEqual(
    core.dailyPuzzleNumber("2026-08-15","2026-08-14"),
    core.dailyPuzzleNumber("2026-08-14","2026-08-14")+1
  );
});

test("v27/v29 aktif oyun kaydı için gerekli migration alanları opsiyonel",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('typeof s.gameAnswerVersion==="string"'));
  assert(app.includes(': "A1"')); // A2 öncesi kayıtlarda version yoktu
  assert(app.includes('typeof s.gameDailyVersion==="string"'));
});

test("v27/v29 istatistikleri tahmin dağılımından ayrıntılı metrik üretebilir",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("derivedTotal"));
  assert(app.includes("derivedBestIndex"));
  assert(app.includes("hasDetailedGuessData"));
});


test("Tek oyunculu ipucu geniş guess pool yerine cevap havuzundan aday üretir",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const start=app.indexOf("function possibleSecrets()");
  const end=app.indexOf("\n\nfunction scoreHintWords",start);
  const block=app.slice(start,end);
  assert(block.includes("CORE.possibleSecrets(ANSWER_WORDS,completed)"));
  assert(!block.includes("CORE.possibleSecrets(WORDS,completed)"));
});

test("PWA manifest release alanları ve ikonlar geçerli",()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,"manifest.webmanifest"),"utf8"));
  assert.strictEqual(manifest.name,"Kelimelik");
  assert.strictEqual(manifest.display,"standalone");
  assert.strictEqual(manifest.start_url,"./");
  assert.strictEqual(manifest.scope,"./");
  assert.strictEqual(manifest.id,"./");
  assert(Array.isArray(manifest.icons) && manifest.icons.length>=2);

  for(const icon of manifest.icons){
    assert(fs.existsSync(path.join(ROOT,icon.src)),icon.src);
  }
});

test("Service Worker sabit runtime cache kullanıyor ve eski cacheleri siliyor",()=>{
  const sw=fs.readFileSync(path.join(ROOT,"sw.js"),"utf8");
  assert(sw.includes('const CACHE_PREFIX="kelimelik-"'));
  assert(sw.includes('const CACHE="kelimelik-runtime"'));
  assert(sw.includes("key.startsWith(CACHE_PREFIX) && key!==CACHE"));
  assert(sw.includes("self.skipWaiting()"));
  assert(sw.includes("self.clients.claim()"));
});

test("Service Worker uygulama kodu için deploy-safe network-first davranış kullanıyor",()=>{
  const sw=fs.readFileSync(path.join(ROOT,"sw.js"),"utf8");
  assert(sw.includes("const NETWORK_FIRST_PATHS=new Set(["));
  for(const asset of [
    './src/css/style.css',
    './src/css/mobile-fixes.css',
    './src/js/app.js',
    './src/js/ui-patches.js',
    './src/js/mobile-fixes.js',
    './src/js/game-core.js',
    './src/js/word-pools.js',
    './src/js/online.js'
  ]) assert(sw.includes(`"${asset}"`),`network-first asset eksik: ${asset}`);
  assert(sw.includes('fetchAndCache(event.request,{cacheMode:"no-cache"})'));
});

test("Service Worker online-config için no-store network-first davranış kullanıyor",()=>{
  const sw=fs.readFileSync(path.join(ROOT,"sw.js"),"utf8");
  assert(sw.includes('const ONLINE_CONFIG_PATH=new URL("./src/js/online-config.js",self.location.href).pathname;'));
  assert(sw.includes("if(url.pathname===ONLINE_CONFIG_PATH)"));
  assert(sw.includes('fetchAndCache(event.request,{cacheMode:"no-store"})'));
});


test("404 sayfası ve geri dönüş bağlantısı mevcut",()=>{
  const file=fs.readFileSync(path.join(ROOT,"404.html"),"utf8");
  assert(file.includes("<title>404 — Kelimelik</title>"));
  assert(file.includes("Ana Sayfaya Dön"));
  assert(fs.existsSync(path.join(ROOT,"src/css/style.css")));
  assert(fs.existsSync(path.join(ROOT,"assets","favicon.svg")));
});


test("Ana sayfada premium tanıtım fazlalıkları kaldırıldı",()=>{
  const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
  for(const removed of [
    ">BETA<",
    "Günlük · Klasik · Mobil",
    "Canlı önizleme",
    "home-highlights",
    "Mobil Uyumlu",
    "Her gün yeni bulmaca"
  ]){
    assert(!html.includes(removed),removed);
  }
  assert(html.includes("Gizli kelimeyi 8 tahminde bul."));
  assert(html.includes('id="startGameBtn"'));
});

test("Mobil board dinamik boyutlandırma ve resize desteğine sahip",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("function updateResponsiveBoardSize()"));
  assert(app.includes('window.addEventListener("resize",updateResponsiveBoardSize)'));
  assert(app.includes('board.style.setProperty("--s"'));
});

test("Mobil CSS safe-area ve küçük ekran kuralları içeriyor",()=>{
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(css.includes("env(safe-area-inset-bottom)"));
  assert(css.includes("@media(max-width:420px)"));
  assert(css.includes("@media(max-width:350px)"));
  assert(css.includes("100dvh"));
  assert(css.includes("place-items:center"));
});


test("PC fiziksel klavyesi oyun girişini destekliyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("function handlePhysicalGameKey(e)"));
  assert(app.includes('e.key==="Backspace"'));
  assert(app.includes('e.key==="Enter"'));
  assert(app.includes('e.key.toLocaleUpperCase("tr-TR")'));
  assert(app.includes("addLetter(letter)"));
  assert(app.includes("backspace()"));
  assert(app.includes("submitGuess()"));
  assert(app.includes('document.addEventListener("keydown",handlePhysicalGameKey)'));
});

test("Tema seçimi tamamen kaldırıldı",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");

  assert(!app.includes("data-theme-choice"));
  assert(!app.includes(">Koyu</button>"));
  assert(!app.includes(">Açık</button>"));
  assert(!app.includes(">Yüksek Kontrast</button>"));
  assert(app.includes("Tema seçimi kaldırıldı"));
  assert(!html.includes("data-theme-choice"));
});


test("Geçersiz kelime satırı için runtime helper fonksiyonları mevcut",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("function clearInvalidRow(row)"));
  assert(app.includes("function markInvalidRow(row)"));
});

test("Tek README kaldırılan tema seçimini önermiyor",()=>{
  const readme=fs.readFileSync(path.join(ROOT,"README.md"),"utf8");
  assert(!readme.includes("yüksek kontrast temalar"));
  assert(!readme.includes("Koyu / açık / yüksek kontrast"));
});


test("Sayaç semantiği: doğru harf + doğru yer = yeşil",()=>{
  const f=core.calculateFeedback("KALEM","KALEM");
  assert.deepStrictEqual([f.green,f.yellow,f.red],[5,0,0]);
});

test("Sayaç semantiği: doğru harf + yanlış yer = sarı",()=>{
  const f=core.calculateFeedback("ALEMK","KALEM");
  assert.deepStrictEqual([f.green,f.yellow,f.red],[0,5,0]);
});

test("Sayaç semantiği: kelimede olmayan harf = kırmızı",()=>{
  const f=core.calculateFeedback("ZZZZZ","KALEM");
  assert.deepStrictEqual([f.green,f.yellow,f.red],[0,0,5]);
});

test("Oyun içi Türkçe Q klavyesi geri geldi",()=>{
  const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");

  assert(html.includes('id="keyboard"'));
  assert(html.includes('class="keyboard-shell"'));
  assert(!html.includes('id="guessInput"'));

  assert(app.includes("function buildKeyboard()"));
  assert(app.includes("function addLetter(letter)"));
  assert(app.includes("function backspace()"));
  assert(app.includes("function renderKeyboardUsage()"));
});

test("Kullanılmış harfler oyun klavyesinde koyulaşıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(app.includes('key.classList.toggle("used",used.has(letter))'));
  assert(css.includes(".key.used"));
});

test("Yeni Oyun kart metinleri istenen şekilde",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("Her gün yeni 5 harfli bulmaca. Günde 1 kez oynanabilir."));
  assert(app.includes("<b>📅 Günlük Bulmaca</b>"));
  assert(!app.includes("Günlük Bulmaca #${dailyPuzzleNumber()}"));
  assert(app.includes("4, 5 veya 6 harf seç. 8 tahminde sayaçları kullanarak kelimeyi bul."));
  assert(app.includes("Profilini oluştur; canlı oda ve eşleşme sistemine gir."));
});


test("Oyun kodu kullanıcı arayüzünden tamamen kaldırıldı",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");

  assert(!app.includes("Oyun kodu ile oyna"));
  assert(!app.includes('id="gameCodeInput"'));
  assert(!app.includes('id="copyGameCodeBtn"'));
  assert(!app.includes('class="game-code-card"'));
  assert(!app.includes("Kod: ${gameCode}"));
  assert(!css.includes(".seed-entry"));
  assert(!css.includes(".game-code-card"));
});

test("TDK kanonik tahmin havuzu açılışta yükleniyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('const CURRENT_ANSWER_VERSION="A3"'));
  assert(app.includes('https://sozluk.gov.tr/autocomplete.json'));
  assert(app.includes('TDK_S%C3%B6zl%C3%BCk_Kelime_Listesi.txt'));
  assert(app.includes('hydrateTdkWordPools().then('));
});

test("TDK anlam endpointi ve uygulama içi anlam ekranı mevcut",()=>{
  const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");

  assert(html.includes("connect-src 'self' https://sozluk.gov.tr https://*.supabase.co wss://*.supabase.co;"));
  assert(app.includes('const TDK_API_BASE="https://sozluk.gov.tr/gts?ara="'));
  assert(app.includes("async function fetchTdkMeaning(word)"));
  assert(app.includes("async function showWordMeaning(word,"));
  assert(app.includes('id="meaningWordBtn"'));
});

test("TDK anlam parserı anlamlarListe alanlarını topluyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("function extractTdkMeanings(payload)"));
  assert(app.includes("entry.anlamlarListe"));
});

test("Bulmacayı Paylaş butonu Unicode ok yerine SVG ikon kullanıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('class="share-icon"'));
  assert(app.includes("function shareIconSVG()"));
  assert(!app.includes("↗ Bulmacayı Paylaş"));
});


test("✓ gönder butonunda hover tooltip mevcut",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('class="key action tooltip-btn" data-a="ok"'));
  assert(app.includes('data-tooltip="Tahmini gönder"'));
});


test("Eski repo dosyaları deploy testini gereksiz yere bozmaz",()=>{
  const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
  const sw=fs.readFileSync(path.join(ROOT,"sw.js"),"utf8");

  /* GitHub web upload mevcut tracked dosyaları otomatik silmez.
     Önemli olan eski dosyaların aktif sayfada referans edilmemesidir. */
  assert(!html.includes('social-card.svg'));
  assert(!html.includes('words.js'));
  assert(!sw.includes('social-card.svg'));
  assert(!sw.includes('./words.js'));
});


test("Yarım kalan günlük bulmaca ayrı anahtarda saklanıp geri yükleniyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('const DAILY_PROGRESS_KEY="kelimelik-daily-progress-v1"'));
  assert(app.includes("function restoreDailyProgress()"));
  assert(app.includes('if(mode==="daily" && restoreDailyProgress())'));
  assert(app.includes("clearDailyProgress()"));
});

test("Paylaşım aynı bulmacaya ait doğrudan bağlantı üretir",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("function currentPuzzleShareToken()"));
  assert(app.includes("function currentPuzzleShareUrl()"));
  assert(app.includes("function parsePuzzleShareToken(token)"));
  assert(app.includes("function startSharedPuzzleFromUrl()"));
  assert(app.includes('`gunluk-${todayKey()}`'));
  assert(app.includes('`klasik-${COLS}-${gameAnswerVersion}-${gameSeed}`'));
  assert(app.includes('`klasikmod-${COLS}-${gameAnswerVersion}-${gameSeed}`'));
  assert(app.includes('?bulmaca=${encodeURIComponent(token)}'));
  assert(app.includes("const url=currentPuzzleShareUrl()"));
  assert(app.includes('const payload={title:"Kelimelik",text}'));
});

test("Ayarlar renk körü modu içeriyor ve animasyon alt yazısı kaldırıldı",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(app.includes("<b>Renk Körü Modu</b>"));
  assert(app.includes('id="colorBlindSetting"'));
  assert(app.includes('classList.toggle("color-blind"'));
  assert(!app.includes("Ana sayfa ve kazanma efektleri"));
  assert(css.includes("html.color-blind"));
  assert(css.includes("--green:#e69f00"));
  assert(css.includes("--yellow:#56b4e9"));
  assert(css.includes("--red:#cc79a7"));
});

test("Oyun üst menüsü sade: nasıl oynanır, paylaş, yeni oyun ve profil",()=>{
  const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
  const how=html.indexOf('id="gameHowBtn"');
  const share=html.indexOf('id="gameShareBtn"');
  const game=html.indexOf('id="modeBtn"');
  const profile=html.indexOf('id="profileBtn"');
  assert(how>=0 && how<share && share<game && game<profile);
  assert(!html.includes('id="statsBtn"'));
  assert(!html.includes('id="settingsBtn"'));
});

test("Profil sade: İstatistikler ve Ayarlar içeride, özet tekrarları yok",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('id="profileStatsBtn">İstatistikler</button>'));
  assert(app.includes('id="profileSettingsBtn">Ayarlar</button>'));
  assert(app.includes('$("#profileStatsBtn").onclick=()=>openStatsModal("overall")'));
  assert(app.includes('$("#profileSettingsBtn").onclick=showSettingsModal'));
  assert(!app.includes("Bu cihazdaki profil"));
  assert(!app.includes('id="profileMatches"'));
  assert(!app.includes('id="profileWinRate"'));
});

test("İstatistiklerde Çok Oy. yerine Online sekmesi kullanılıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('data-stats-category="multiplayer">Online</button>'));
  assert(!app.includes('data-stats-category="multiplayer">Çok Oy.</button>'));
});

test("Çok Oyunculu kart açıklamaları kısa metinleri kullanıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("Özel oda oluştur. Davet bağlantısını gönder. Arkadaşınla aynı bulmaca üzerinde yarış"));
  assert(app.includes("Aynı moddaki çevrimiçi oyuncularla yarış"));
  assert(app.includes("İnsan temposuna sahip botlarla yarış"));
  assert(!app.includes("performansı en yakın rakibi ara"));
  assert(!app.includes("Efe, Defne veya Atlas'a karşı insan temposunda canlı maç oyna"));
});

test("Hızlı eşleşme animasyonu görünür sayaç olmadan akıcı çalışıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(app.includes('if(!root.querySelector(".quick-waiting-card"))'));
  assert(!app.includes('id="quickElapsed"'));
  assert(app.includes('id="quickBotSlot"'));
  assert(app.includes('aria-label="Rakip aranıyor"'));
  assert(css.includes(".quick-search-ring::before"));
  assert(!css.includes(".quick-search-time strong"));
  assert(css.includes("animation:quickSearchSpin .95s linear infinite"));
});

test("Arkadaş odası metni ve Klasik standard etiketi yeni sade sunumu kullanıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(app.includes("Özel oda oluştur veya 6 haneli oda koduyla katıl."));
  assert(app.includes('classic-standard-badge">standart'));
  assert(css.includes("left:50%;bottom:6px"));
  assert(css.includes("font-size:7px"));
});

test("İç ekran geri dönüşleri yalnızca çarpı/closeAction ile çalışıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(!app.includes('id="historyBackBtn"'));
  assert(!app.includes("← Ayarlara Dön"));
  assert(!app.includes("← Oyun Modlarına Dön"));
  assert(!app.includes("← Çok Oyunculuya Dön"));
  assert(!app.includes('id="classicBackBtn"'));
  assert(!app.includes('id="directClassicBackBtn"'));
  assert(!app.includes('id="multiplayerBackBtn"'));
  assert(!app.includes('id="friendLiveBackBtn"'));
  assert(!app.includes('id="quickSetupBack"'));
  assert(!app.includes('id="botSetupBack"'));
  assert(!app.includes('id="meaningBackBtn"'));
  assert(app.includes("closeAction:showSettingsModal"));
  assert(app.includes("{closeAction:showNewGameSelector}"));
  assert(app.includes("{closeAction:showMultiplayerMenu}"));
});


test("Masaüstü oyun ekranı daha kompakt ve yüksekliğe duyarlı",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(app.includes("const height=Math.max(520,Number(window.innerHeight)||900)"));
  assert(app.includes("height<690 ? 38 : height<780 ? 41 : height<880 ? 43 : 45"));
  assert(css.includes("width:min(700px,calc(100% - 20px))"));
  assert(css.includes("@media(min-width:761px) and (max-height:760px)"));
});

test("Nasıl oynanır ekranı Kelimelik ve Klasik mod kurallarını açıklıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("◆ Kelimelik Modu"));
  assert(app.includes("▦ Klasik Mod"));
  assert(app.includes("tahmin hakkın azalmaz"));
  assert(app.includes("Backspace"));
  assert(app.includes("Yarım bırakırsan aynı gün kaldığın yerden devam edersin"));
});


test("Animasyon ayarı yalnızca oyun ekranını etkiliyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");

  assert(app.includes('document.getElementById("gameScreen")'));
  assert(app.includes('gameScreen.classList.toggle("reduce-motion",!settings.animations)'));
  assert(!app.includes('document.documentElement.classList.toggle("reduce-motion"'));

  assert(css.includes("#gameScreen.reduce-motion *"));
  assert(!css.includes("html.reduce-motion *"));
});


test("Oyun içi animasyonlar belirgin harf, tahmin ve sayaç efektleri içeriyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");

  assert(app.includes("function animateTileEntry(row,col)"));
  assert(app.includes("function animateSubmittedRow(row)"));
  assert(app.includes('tile.classList.add("tile-pop")'));
  assert(app.includes('tile.classList.add("tile-submit")'));
  assert(app.includes('box.classList.add("counter-reveal")'));

  assert(css.includes("@keyframes tilePop"));
  assert(css.includes("@keyframes tileSubmit"));
  assert(css.includes("@keyframes counterReveal"));
});

test("Kazanma efekti emoji değil yoğun gerçek confetti yağmuru kullanıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");

  assert(app.includes("for(let i=0;i<96;i++)"));
  assert(app.includes("confetti-piece confetti-shape-"));
  assert(app.includes('setTimeout(()=>layer.remove(),5000)'));
  assert(!app.includes("🎊"));
  assert(!app.includes("🎉") || app.includes("result-celebration"));

  assert(css.includes("@keyframes confettiRain"));
  assert(css.includes("112vh"));
  assert(css.includes("--drift-a"));
  assert(css.includes("--drift-b"));
});

test("Animasyon kapalıyken yeni oyun efektleri ve confetti devre dışı kalıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const tileStart=app.indexOf("function animateTileEntry");
  const submitStart=app.indexOf("function animateSubmittedRow");
  const confettiStart=app.indexOf("function launchConfetti");

  assert(app.slice(tileStart,tileStart+180).includes("if(!loadSettings().animations)return"));
  assert(app.slice(submitStart,submitStart+180).includes("if(!loadSettings().animations)return"));
  assert(app.slice(confettiStart,confettiStart+180).includes("if(!loadSettings().animations)return"));
});


test("Günlük istatistik durumu tarih ile sade gösteriliyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(app.includes("function formatDateTR"));
  assert(app.includes('"Günün Bulmacası Çözüldü"'));
  assert(app.includes('"Günün Bulmacası Çözülmedi"'));
  assert(app.includes("${formatDateTR(todayKey())}"));
  assert(!app.includes("<strong>Bugünkü durum</strong>"));
  assert(css.includes(".daily-status time"));
});

test("Paylaşılan klasik bulmaca seed ve sözlük sürümünü koruyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("puzzle.seed"));
  assert(app.includes("puzzle.answerVersion"));
  assert(app.includes('return `klasik-${COLS}-${gameAnswerVersion}-${gameSeed}`'));
  assert(app.includes('return `klasikmod-${COLS}-${gameAnswerVersion}-${gameSeed}`'));
});

test("Eski tarihli günlük paylaşım aynı cevabı paylaşılan modda açabiliyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("function startSharedDailyPuzzle(dateKey,token)"));
  assert(app.includes("const info=getDailyPuzzleInfo(dateKey)"));
  assert(app.includes('gameMode="shared"'));
  assert(app.includes("secretWord=info.word"));
});





test("Günlük tamamlandı ekranındaki Klasik Oyun Oyna harf seçimine gider",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const start=app.indexOf('$("#dailyPracticeBtn").onclick');
  const end=app.indexOf('$("#dailyBackBtn")',start);
  const block=app.slice(start,end);
  assert(block.includes("showClassicLengthSelector()"));
  assert(!block.includes('newGame("practice")'));
});

test("Oyun masaüstünde gereksiz küçülmeden ekran yüksekliğine göre uyarlanıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(app.includes("height<690 ? 38 : height<780 ? 41 : height<880 ? 43 : 45"));
  assert(css.includes("--s:45px"));
  assert(css.includes("height:43px"));
});

test("Üst bar ve klavye kabı masaüstünde aynı genişlikte",()=>{
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(css.includes(".topbar,.keyboard-shell{width:min(700px,calc(100% - 20px))}"));
});

test("Günlük istatistik kartı eski numaralı metni göstermiyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('"Günün Bulmacası Çözüldü"'));
  assert(app.includes('"Günün Bulmacası Çözülmedi"'));
  assert(app.includes('class="daily-status-text"'));
  assert(app.includes("<time datetime="));
  assert(!app.includes("<strong>Bugünkü durum</strong>"));
  assert(!app.includes("Günlük #${dailyPuzzleNumber()} tamamlandı"));
});




test("Günlük sonuç kaydı cevap kelimesini de saklıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("word:secretWord"));
});

test("Bugünkü günlük sonuç geçmiş veya aktif oyun kanıtından onarılabiliyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("function todayDailyHistoryResult()"));
  assert(app.includes("function todayDailySavedGameResult()"));
  assert(app.includes("function todayDailyEvidenceResult()"));
  assert(app.includes("function repairTodayDailyState()"));
  assert(app.includes("function repairDailyStatsWinFromEvidence(tries)"));
  assert(app.includes("evidence?.won && next.won!==true"));
});

test("Günlük istatistik çözüldüğünde kelime ve N/8 sonucunu gösteriyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");

  assert(app.includes("function getTodayDailySummary()"));
  assert(app.includes('class="daily-status-detail"'));
  assert(app.includes("${escapeHTML(daily.word)} ${daily.won && daily.tries ? `${daily.tries}/8` : \"X/8\"}"));
  assert(app.includes('`${daily.tries}/8`'));
  assert(css.includes(".daily-status-detail"));
});

test("Günlük stats sekmesi sonucu göstermeden önce eski kaydı onarıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('if(tab==="daily")repairTodayDailyState();'));
});


test("Privacy Policy online Supabase veri akışını açıkça belirtiyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("Supabase</b> Auth/Database/Realtime"));
  assert(app.includes("İlk online sürüm e-posta veya şifre istemez."));
});

test("Privacy Policy görünür son güncelleme satırı içermiyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(!app.includes("Son güncelleme:"));
  assert(app.includes("<h2>Privacy Policy</h2>"));
});


test("Kazanırken sonuç ekranı kutu ve sayaç animasyonları bittikten sonra açılıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");

  assert(app.includes("function submittedRowAnimationDuration()"));
  assert(app.includes("const tileSequence=620+Math.max(0,COLS-1)*65"));
  assert(app.includes("const counterSequence=COLS*65+2*95+420"));
  assert(app.includes("return Math.max(tileSequence,counterSequence)+320"));
  assert(app.includes("scheduleResultReveal(true,tries,runId)"));
  assert(app.includes("recordGameResult(true,tries)"));
});

test("Sonuç Yeni Oyun butonu animasyon açıkken periyodik parlama içeriyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");

  assert(app.includes('result-new-game-btn ${loadSettings().animations?"result-new-game-animated":""}'));
  assert(css.includes("@keyframes resultNewGameGlow"));
  assert(css.includes("@keyframes resultNewGameSheen"));
});


test("Günlük kart alt detayı tek küçük satırda kelime ve N/8 gösteriyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");

  assert(app.includes('class="daily-status-detail"'));
  assert(app.includes('${escapeHTML(daily.word)} ${daily.won && daily.tries ? `${daily.tries}/8` : "X/8"}'));
  assert(!app.includes("<strong>${escapeHTML(daily.word)}</strong>"));
  assert(css.includes(".daily-status-detail"));
  assert(css.includes("font-size:12px"));
  assert(!css.includes(".daily-status-detail strong"));
  assert(!css.includes(".daily-status-detail span"));
});


test("Yüklenen landing animasyonunun matrix rain ve decode mantığı entegre",()=>{
  const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");

  assert(html.includes('id="homeAmbient"'));
  assert(html.includes('class="ambient-halo"'));
  assert(html.includes('class="home-demo-divider"'));

  assert(app.includes('const HOME_GLYPHS="ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ"'));
  assert(app.includes("function ensureHomeMatrixRain()"));
  assert(app.includes("function decodeHomeCell("));
  assert(app.includes("const HOME_SCRAMBLE=320"));
  assert(app.includes("const HOME_COUNT_SCRAMBLE=240"));
  assert(app.includes("const HOME_STEP=95"));
  assert(app.includes("const HOME_HOLD=850"));
  assert(app.includes('col.className="rain-col"'));
  assert(app.includes('el.classList.add("home-scrambling")'));
  assert(app.includes('el.classList.add(counter ? "home-reveal" : "home-locked")'));

  assert(css.includes("@keyframes landingRainFall"));
  assert(css.includes("@keyframes landingTileLock"));
  assert(css.includes("@keyframes landingBtnSheen"));
  assert(css.includes("@keyframes landingArrowNudge"));
});

test("Ana sayfa decode animasyonunda harfler ve sayılar aynı yeşil scramble efektini kullanıyor",()=>{
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(css.includes(".animated-letter.home-scrambling"));
  assert(css.includes(".animated-count.home-scrambling"));
  assert(css.includes("color:var(--green)"));
  assert(css.includes("text-shadow:0 0 6px rgba(89,173,85,.45)"));
  assert(!css.includes("color:rgba(20,20,20,.55)"));
});

test("Sayı scramble yeşil efekti harflerle aynı",()=>{
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(css.includes(".animated-letter.home-scrambling"));
  assert(css.includes(".animated-count.home-scrambling"));
  assert(css.includes("color:var(--green)"));
  assert(css.includes("text-shadow:0 0 6px rgba(89,173,85,.45)"));
  assert(app.includes("const allItems=[...tileItems,...countItems];"));
  assert(app.includes("startHomeScrambleLoop(allItems,runId)"));
});

test("Yeşil scramble reveal sırasına kadar kesilmeden devam ediyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("let homeScrambleHandles=[]"));
  assert(app.includes("function startHomeScrambleLoop(items,runId)"));
  assert(app.includes("setInterval"));
  assert(app.includes('el.classList.contains("home-scrambling")'));
  assert(app.includes("const active=items.filter"));
  assert(app.includes("startHomeScrambleLoop(allItems,runId)"));
  assert(app.includes("clearHomeScrambles();"));
});

test("Ana sayfa sayaçları harflerle aynı HOME_STEP ritminde devam ediyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("const countsStart=revealStart+tiles.length*HOME_STEP;"));
  assert(!app.includes("const countsStart=revealStart+tiles.length*HOME_STEP+70;"));
});

test("Sayaç scramble yeşili renkli kutu üzerinde kaybolmuyor",()=>{
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  const start=css.indexOf(".animated-count.home-scrambling{");
  const end=css.indexOf("}",start);
  const block=css.slice(start,end+1);

  assert(block.includes("background:var(--tile)"));
  assert(block.includes("color:var(--green)"));
  assert(block.includes("opacity:.55"));
  assert(block.includes("text-shadow:"));
  assert(block.includes("rgba(89,173,85,.45)"));
});

test("Hızlı yazma düzeltmesi güncel ana sayfa sayı animasyonunu geri almıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");

  assert(app.includes("const countsStart=revealStart+tiles.length*HOME_STEP;"));
  assert(!app.includes("const countsStart=revealStart+tiles.length*HOME_STEP+70;"));
  assert(css.includes("background:var(--tile)"));
  assert(css.includes("rgba(89,173,85,.45)"));
});

test("Ana sayfa sayı scramble kutuları harflerle aynı arka plan ve çerçeveyi kullanıyor",()=>{
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");

  const letterStart=css.indexOf(".animated-letter.home-scrambling{");
  const letterEnd=css.indexOf("}",letterStart);
  const letterBlock=css.slice(letterStart,letterEnd+1);

  const countStart=css.indexOf(".animated-count.home-scrambling{");
  const countEnd=css.indexOf("}",countStart);
  const countBlock=css.slice(countStart,countEnd+1);

  assert(countBlock.includes("background:var(--tile)"));
  assert(countBlock.includes("border:0"));
  assert(countBlock.includes("opacity:.55"));
  assert(countBlock.includes("text-shadow:0 0 6px rgba(89,173,85,.45)"));
  assert(letterBlock.includes("opacity:.55"));
  assert(letterBlock.includes("text-shadow:0 0 6px rgba(89,173,85,.45)"));
});


test("Landing logo parçaları sıralı bitIn animasyonuyla geliyor",()=>{
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(css.includes("@keyframes landingBitIn"));
  assert(css.includes(".home-logo-mark .t1{animation-delay:.16s!important}"));
  assert(css.includes(".home-logo-mark .b3{animation-delay:.51s!important}"));
  assert(css.includes(".home-logo-mark{"));
  assert(css.includes("animation:none!important"));
});

test("Ana sayfa Oyuna Başla butonu periyodik sheen ve ok hareketine sahip",()=>{
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(css.includes("landingBtnSheen 3.4s ease-in-out .9s infinite"));
  assert(css.includes("landingArrowNudge 1.6s ease-in-out .9s infinite"));
});

test("Ana sayfa animasyonu oyun içi Animasyonlar ayarından bağımsız kalıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('gameScreen.classList.toggle("reduce-motion",!settings.animations)'));
  assert(!app.includes('homeScreen.classList.toggle("reduce-motion"'));
});


test("Masaüstü klavye mobildeki gibi üç aksiyon butonunu altta yatay diziyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");

  assert(app.includes('last.className="key-row key-action-row"'));
  assert(app.includes('data-a="erase"'));
  assert(app.includes('data-a="hint"'));
  assert(app.includes('data-a="ok"'));

  assert(css.includes("/* Masaüstünde de mobildeki sade Q klavye düzeni kullanılır. */"));
  assert(css.includes("display:flex;flex-direction:column"));
  assert(css.includes("flex-direction:row!important"));
  assert(css.includes("justify-content:center!important"));
});

test("Mobilde üç klavye aksiyonu yatay kalıyor",()=>{
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(css.includes("flex-direction:row!important"));
  assert(css.includes("justify-content:center!important"));
});

test("Oyun görünümünde masaüstü scrollbar flaşı kökten engelleniyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");

  assert(app.includes('document.documentElement.classList.add("game-view")'));
  assert(app.includes('document.documentElement.classList.remove("game-view")'));
  assert(app.includes('document.body.classList.add("game-view")'));
  assert(css.includes("html.game-view"));
  assert(css.includes("overflow:hidden!important"));
  assert(css.includes("overflow-y:hidden!important"));
  assert(css.includes("position:fixed"));
  assert(css.includes("overflow:clip"));
});

test("Masaüstü klavye ortak yatay aksiyon düzeninde kompakt kalıyor",()=>{
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(css.includes("width:min(700px,calc(100% - 20px));max-width:700px"));
  assert(css.includes("margin-top:12px;padding:10px 10px 9px"));
});


test("İstatistik sıfırlama onay metni istenen şekilde",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("İstatistikler sıfırlansın mı ? Günlük bulmaca hakkın değişmez."));
  assert(!app.includes("İstatistikler sıfırlansın mı? Günlük bulmaca hakkın korunur."));
});


test("Oyun sırasında paylaş butonu Nasıl oynanır butonunun yanında",()=>{
  const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
  const how=html.indexOf('id="gameHowBtn"');
  const share=html.indexOf('id="gameShareBtn"');
  const newGame=html.indexOf('id="modeBtn"');
  assert(how>=0 && share>how && newGame>share);
  assert(html.includes('data-tooltip="Bulmacayı paylaş"'));
  assert(html.includes('class="top-share-icon"'));
});

test("Oyun sırasında paylaşım cevap veya mevcut tahminleri ifşa etmiyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const start=app.indexOf("function buildPuzzleInviteText()");
  const end=app.indexOf("\nasync function shareCurrentPuzzle",start);
  const block=app.slice(start,end);
  assert(block.includes("Kelimelik'te sana bir bulmaca gönderdim. Çözebilir misin?"));
  assert(!block.includes("secretWord"));
  assert(!block.includes("feedbacks"));
  assert(!block.includes("guesses"));
});

test("Oyun sırasında paylaşım aynı bulmacanın doğrudan URL'sini kullanıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const start=app.indexOf("async function shareCurrentPuzzle()");
  const end=app.indexOf("\nasync function sharePuzzle",start);
  const block=app.slice(start,end);
  assert(block.includes("currentPuzzleShareUrl()"));
  assert(block.includes("navigator.share"));
  assert(block.includes("navigator.clipboard"));
  assert(block.includes("Bulmaca bağlantısı panoya kopyalandı."));
  assert(app.includes('$("#gameShareBtn").onclick=showShareMenu'));
  assert(app.includes('id="shareExistingPuzzleBtn"'));
  assert(app.includes('shareCurrentPuzzle();'));
});

test("Sonuç ekranındaki paylaşım mevcut sonuç paylaşımını koruyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("async function sharePuzzle(won,tries)"));
  assert(app.includes("buildShareText(won,tries)"));
  assert(app.includes('$("#shareResultBtn").onclick=()=>sharePuzzle(won,won?tries:null)'));
});


test("Kazanma ekranı animasyon bittikten sonra biraz daha geç açılıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("return Math.max(tileSequence,counterSequence)+320"));
});


test("Paylaşılan bulmaca tamamlandıktan sonra aynı tarayıcıda tekrar oynatılamıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('const SHARED_PLAY_KEY="kelimelik-shared-play-v1"'));
  assert(app.includes("function sharedPuzzleCompleted(token)"));
  assert(app.includes("function prepareSharedPuzzleStart(token)"));
  assert(app.includes('if(existing?.completed)'));
  assert(app.includes("showSharedAlreadyCompleted(existing)"));
  assert(app.includes("yalnızca bir kez oynanabilir"));
});

test("Yarım kalan paylaşılan bulmaca token bazında kaldığı yerden devam ediyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("function restoreSharedPuzzleProgress(token)"));
  assert(app.includes('if(gameMode==="shared" && sharedPuzzleToken)'));
  assert(app.includes("saveSharedPlay(sharedPuzzleToken"));
  assert(app.includes("restoreSharedPuzzleProgress(token)"));
});

test("Klasik paylaşım linki paylaşılan mod olarak başlatılıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("function startSharedClassicPuzzle(puzzle)"));
  assert(app.includes('gameMode="shared"'));
  assert(app.includes("sharedPuzzleToken=puzzle.token"));
});

test("Paylaşım mesajı doğal metin kullanıyor ve native paylaşım URL'yi ayrı gönderiyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("Kelimelik'te sana bir bulmaca gönderdim. Çözebilir misin?"));
  assert(app.includes("function buildPuzzleInviteText()"));
  assert(app.includes('const payload={title:"Kelimelik",text}'));
  assert(app.includes("if(url)payload.url=url"));
  assert(app.includes("await navigator.share(payload)"));
});

test("Open Graph link önizlemesi için mutlak sosyal kart metaları mevcut",()=>{
  const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
  assert(html.includes('property="og:site_name" content="Kelimelik"'));
  assert(html.includes('property="og:image:width" content="1200"'));
  assert(html.includes('property="og:image:height" content="630"'));
  assert(html.includes('https://kelime-lik.vercel.app/assets/social-card.png'));
  assert(html.includes("Kelimelik'te paylaşılan bulmacayı çöz"));
});

test("Native paylaşım text ve URL'yi ayrı alanlarda gönderiyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const a=app.slice(app.indexOf("async function shareCurrentPuzzle()"),app.indexOf("\nasync function sharePuzzle"));
  const b=app.slice(app.indexOf("async function sharePuzzle(won,tries)"),app.indexOf("\nfunction showResultModal"));
  for(const block of [a,b]){
    assert(block.includes('const payload={title:"Kelimelik",text}'));
    assert(block.includes("if(url)payload.url=url"));
    assert(block.includes("navigator.share(payload)"));
  }
});

test("Stabil sürüm canonical adresi koruyor, puzzle OG URL'sini sabitlemiyor",()=>{
  const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
  assert(!html.includes('<meta property="og:url"'));
  assert(html.includes('<link rel="canonical" href="https://kelime-lik.vercel.app/">'));
  assert(html.includes('assets/social-card.png?v=20'));
});

test("README oyun bilgileri, kod bütünlüğü ve çalıştırma akışını anlatıyor; sürüm günlüğü taşımıyor",()=>{
  const readme=fs.readFileSync(path.join(ROOT,"README.md"),"utf8");
  assert(readme.startsWith("# Kelimelik"));
  assert(readme.includes("## Oyun Bilgileri"));
  assert(readme.includes("## Kod Bütünlüğü"));
  assert(readme.includes("## Nasıl Çalıştırılır"));
  assert(readme.includes("### Supabase"));
  assert(readme.includes("### Test"));
  assert(!readme.includes("Son Sürüm"));
  assert(!/v\d+\.\d+\.\d+/.test(readme));
  assert(!readme.includes("CI compatibility"));
});


test("Geçersiz kelime popup açmadan kırmızı satır animasyonu gösteriyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");

  const start=app.indexOf("function markInvalidRow(row)");
  const end=app.indexOf("\n\n/* Gerçek harf geri bildirimi sayımı",start);
  const block=app.slice(start,end);

  assert(block.includes('tile.classList.add("invalid-word")'));
  assert(block.includes("clearInvalidRow(row)"));
  assert(!block.includes("flashMessage("));
  assert(!block.includes("showModal("));

  assert(css.includes(".tile.invalid-word"));
  assert(css.includes("@keyframes invalidWordShakeRed"));
  assert(css.includes("background:var(--red)"));
  assert(css.includes("border:1px solid var(--red)!important"));
});

test("Geçersiz kelime popup metni kaldırıldı",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(!app.includes('flashMessage("Bu kelime sözlükte bulunamadı.")'));
});


test("Son satır animasyonu oyun viewport yüksekliğini aşamıyor",()=>{
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(css.includes("max-height:100dvh"));
  assert(css.includes("body.game-view #gameScreen"));
});


test("Hızlı yazarken render mevcut kutu animasyonlarını yarıda kesmiyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");

  const start=app.indexOf("function render(){");
  const end=app.indexOf("\nfunction buildKeyboard()",start);
  const block=app.slice(start,end);

  assert(block.includes('const nextClass="tile"'));
  assert(block.includes("if(t.textContent!==cell.letter)"));
  assert(block.includes("t.dataset.baseClass!==nextClass"));
  assert(block.includes('"tile-pop","tile-submit","invalid-word"'));
  assert(block.includes("t.className=[nextClass,...transient].join"));
  assert(!block.includes('t.className="tile"+(cell.state'));
});

test("Hızlı kutu animasyonları game-area dışına taşmıyor",()=>{
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");

  assert(css.includes(".game-area{overflow:hidden}"));
  assert(css.includes("padding-block:6px"));
});

test("CSS süslü parantezleri dengeli",()=>{
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8").replace(/\/\*[\s\S]*?\*\//g,"");
  let depth=0;
  for(const ch of css){
    if(ch==="{")depth++;
    if(ch==="}")depth--;
    assert(depth>=0,"CSS içinde eşleşmeyen kapanış parantezi var");
  }
  assert.strictEqual(depth,0);
});

test("Persist edilen geçmiş/favori verileri normalize ve escape ediliyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("function normalizeStoredWord(value)"));
  assert(app.includes("data-meaning-word=\"${escapeHTML(word)}\""));
  assert(app.includes("<b>${escapeHTML(visibleWord)}</b>"));
  assert(app.includes("target.textContent=String(msg??\"\")"));
});

test("Son tahmin sonucu animasyondan önce kaydediliyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const start=app.indexOf("function submitGuess(){");
  const end=app.indexOf("\n\nfunction renderKeyboardUsage",start);
  const block=app.slice(start,end);
  assert(block.includes("recordGameResult(true,tries);"));
  assert(block.includes("recordGameResult(false,null);"));
  assert(block.includes("scheduleResultReveal(true,tries,runId);"));
  assert(block.includes("scheduleResultReveal(false,null,runId);"));
});

test("Service Worker diğer projelerin cache'lerine dokunmuyor",()=>{
  const sw=fs.readFileSync(path.join(ROOT,"sw.js"),"utf8");
  assert(sw.includes('const CACHE_PREFIX="kelimelik-"'));
  assert(sw.includes("key.startsWith(CACHE_PREFIX)"));
  assert(sw.includes("url.origin!==self.location.origin"));
  assert(sw.includes('event.request.mode==="navigate"'));
  assert(sw.includes("ASSET_PATHS.has(url.pathname)"));
});

test("README güvenlik bilgisini ve erişilebilir durum bölgesini koruyor",()=>{
  const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
  const readme=fs.readFileSync(path.join(ROOT,"README.md"),"utf8");
  assert(readme.includes("service_role"));
  assert(readme.includes("Vercel güvenlik başlıkları"));
  assert(html.includes('id="gameStatus"'));
  assert(html.includes('role="dialog"'));
  assert(html.includes('aria-modal="true"'));
  assert(html.includes('aria-label="Pencereyi kapat"'));
});

test("Kullanılmayan social-card.svg final pakette yok",()=>{
  assert(!fs.existsSync(path.join(ROOT,"assets","social-card.svg")));
});


test("Mobil ana sayfa demo satırında gizli divider sütunu kalmadı",()=>{
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(css.includes("grid-template-columns:repeat(8,min(10.3vw,45px))"));
  assert(!css.includes("repeat(5,min(10.3vw,45px))\\n      8px"));
});

test("Service Worker offline fallback'ı yalnızca aktif Kelimelik runtime cache'inde tutuyor",()=>{
  const sw=fs.readFileSync(path.join(ROOT,"sw.js"),"utf8");
  assert(sw.includes("const cache=await caches.open(CACHE)"));
  assert(sw.includes("cache.match("));
  assert(sw.includes("fallbackKey || request"));
});

test("Landing CSS tek aktif ana home-screen bloğuna konsolide edildi",()=>{
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(css.includes("position:relative;isolation:isolate;overflow:hidden;"));
  assert(css.includes("background:var(--bg)"));
  assert.strictEqual((css.match(/\.home-screen > \.home-card/g)||[]).length,1);
  for(const obsolete of [
    "circle at 50% 15%",
    "circle at 50% 14%",
    "circle at 82% 78%",
    "circle at 50% 18%"
  ]) assert(!css.includes(obsolete),`eski home-screen background kaldı: ${obsolete}`);
});


test("GitHub Actions test workflow'u salt-okunur token ve güncel official actions kullanıyor",()=>{
  const workflow=fs.readFileSync(path.join(ROOT,".github","workflows","kelimelik-tests.yml"),"utf8");
  assert(workflow.includes("permissions:\n  contents: read"));
  assert(workflow.includes("actions/checkout@v7.0.1"));
  assert(workflow.includes("persist-credentials: false"));
  assert(workflow.includes("actions/setup-node@v7.0.0"));
  assert(workflow.includes('node-version: "20"'));
  assert(workflow.includes("package-manager-cache: false"));
});



test("Supabase SDK geçici indirme hatasından sonra loader yeniden denenebilir",()=>{
  const online=fs.readFileSync(path.join(ROOT,"src/js/online.js"),"utf8");
  assert(online.includes("sdkPromise=null;"));
  assert(online.includes('script.onerror=()=>fail("Supabase SDK indirilemedi.")'));
});

test("GitHub Actions release audit smoke testlerini de çalıştırıyor",()=>{
  const workflow=fs.readFileSync(path.join(ROOT,".github/workflows/kelimelik-tests.yml"),"utf8");
  assert(workflow.includes("node tests/session-repair-online-smoke.js"));
  assert(workflow.includes("node tests/release-hardening-schema-smoke.js"));
  assert(workflow.includes("node tests/migration-sanity-smoke.js"));
  assert(workflow.includes("node tests/sdk-retry-online-smoke.js"));
});

test("Uygulama eval/new Function/document.write gibi dinamik kod çalıştırma kullanmıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(!/\beval\s*\(/.test(app));
  assert(!/new\s+Function\s*\(/.test(app));
  assert(!/document\.write\s*\(/.test(app));
});

test("CSP script/worker/frame kaynaklarını sınırlandırıyor",()=>{
  const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
  assert(html.includes("script-src 'self'"));
  assert(html.includes("worker-src 'self'"));
  assert(html.includes("frame-src 'none'"));
  assert(html.includes("object-src 'none'"));
  assert(html.includes("base-uri 'self'"));
});

test("Sosyal kart optimize edilmiş 1200x630 PNG ve gereksiz büyük değil",()=>{
  const file=path.join(ROOT,"assets","social-card.png");
  assert(fs.statSync(file).size<150000);
});


test("Aynı günlük puzzle günlük ve shared geçmişte tek kayda birleşiyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("function historyPuzzleKey(item)"));
  assert(app.includes("function mergeHistoryEntries(a,b)"));
  assert(app.includes("function repairHistoryEntries(entries)"));
  assert(app.includes("function currentHistoryPuzzleKey()"));
});

test("Tamamlanmış günlük paylaşılan linkten ikinci kez oynatılamıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const start=app.indexOf("function startSharedDailyPuzzle(dateKey,token)");
  const end=app.indexOf("\nfunction startSharedClassicPuzzle",start);
  const block=app.slice(start,end);
  assert(block.includes("completedDailyResultForDate(dateKey)"));
  assert(block.includes("saveSharedPlay(token"));
  assert(block.includes("showSharedAlreadyCompleted(completedDaily)"));
});

test("Çözülmeyen günlük özetinde cevap kelimesi gösterilmiyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const start=app.indexOf("function getTodayDailySummary()");
  const end=app.indexOf("\nfunction dailyPlayedToday",start);
  const block=app.slice(start,end);
  assert(block.includes("const word=won"));
});

test("Eksik harfli tahmin popup yerine kırmızı satır animasyonu kullanıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const start=app.indexOf("function submitGuess()");
  const end=app.indexOf("\nfunction renderKeyboardUsage",start);
  const block=app.slice(start,end);
  assert(block.includes("markInvalidRow(activeRow)"));
  assert(block.includes("announceGameStatus(`Tahmin ${COLS} harf olmalı."));
  assert(!block.includes("flashMessage(`Önce ${COLS} harf gir.`)"));
});

test("Çözülmeyen günlük geçmişi cevabı ve anlam butonunu saklıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('const unresolvedDaily=item.mode==="daily" && !item.won'));
  assert(app.includes('const visibleWord=unresolvedDaily ? "ÇÖZÜLEMEDİ" : item.word'));
  assert(app.includes("history-meaning-muted"));
});



test("Modal kapatma butonu yalnız gerçek üst başlıkla hizalanıyor",()=>{
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");

  assert(app.includes("function alignModalCloseButton()"));
  assert(app.includes("Array.from(modalBody.children||[])"));
  assert(app.includes('modalBody.querySelector?.(".live-match-head h2")'));
  assert(!app.includes('const heading=modalBody.querySelector?.("h2")'));
  assert(app.includes('modal.style.setProperty("--modal-close-top"'));
  assert(app.includes('requestAnimationFrame(alignModalCloseButton)'));
  assert(app.includes('new MutationObserver'));
  assert(css.includes("top:var(--modal-close-top,12px)!important"));
  assert(css.includes("right:12px!important"));
});


test("Yeni oyun menüsü Kelimelik Modu ve Klasik Modu ayrı gösteriyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("◆ Kelimelik Modu"));
  assert(app.includes("▦ Klasik Mod"));
  assert(app.includes('id="selectDirectClassicGame"'));
  assert(app.includes('showDirectClassicLengthSelector()'));
  assert(app.includes('newGame("classic",length)'));
});

test("Klasik Mod 4/5/6 için 5/6/7 tahmin kullanıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("function isClassicVariant()"));
  assert(app.includes("function classicAttemptLimit(length=COLS)"));
  assert(app.includes("return [4,5,6].includes(n) ? n+1 : 6"));
  assert(app.includes('if(mode==="daily")length=5'));
  assert(app.includes('data-classic-length="4"'));
  assert(app.includes('data-classic-length="5"'));
  assert(app.includes('data-classic-length="6"'));
  assert(app.includes('classic-standard-badge">standart'));
  assert(app.includes("const attempts=currentAttemptLimit()"));
  assert(app.includes("const counterColumns=isClassicVariant() ? 0 : 3"));
});

test("Klasik Mod tahmin sonrası harfleri doğrudan boyuyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("feedbacks[submittedRow].pattern.forEach"));
  assert(app.includes("guesses[submittedRow][index].state=state"));
  assert(app.includes("submittedRow===currentAttemptLimit()-1"));
});

test("Klasik Mod klavyesi feedback renklerini gösteriyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(app.includes("feedback-green"));
  assert(app.includes("feedback-yellow"));
  assert(app.includes("feedback-red"));
  assert(css.includes(".key.feedback-green"));
  assert(css.includes(".key.feedback-yellow"));
  assert(css.includes(".key.feedback-red"));
});

test("Kelimelik ipucusu mevcut en yüksek yeşil sayısını koruyan adayları kullanıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("function bestSubmittedGreenCount()"));
  assert(app.includes("function hintCandidatesWithGreenFloor(candidates)"));
  assert(app.includes("CORE.filterHintWordsByGreenFloor"));
  assert(app.includes("greenSafeCandidates.length ? greenSafeCandidates : candidates"));
});

test("Klasik Mod ipucu ve manuel işaretlemeyi kapatıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("Klasik Modda ipucu yok"));
  assert(app.includes("Klasik Modda manuel işaretleme yok"));
});

test("Klasik Mod istatistikleri ayrı bucket ve sekmede tutuluyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("classicMode:emptyStatBucket()"));
  assert(app.includes("classicMode:normalizeBucket(current.classicMode)"));
  assert(app.includes('data-stats-tab="classicMode"'));
  assert(app.includes('if(tab==="classicMode")return stats.classicMode'));
  assert(app.includes("bucket.guessDistribution.slice(0,7)"));
});

test("Paylaşılan geçmiş satırı harf sayısı yerine Paylaşılan etiketi gösteriyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('? "Paylaşılan"'));
  assert(app.includes("Number(item.attemptLimit)||8"));
});

test("Yeni Klasik paylaşım tokenı eski Kelimelik tokenından ayrılıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("klasikmod-${COLS}-"));
  assert(app.includes('mode:"classic"'));
  assert(app.includes('mode:"practice"'));
});

test("Kullanıcı metinlerinde başka oyun markası kullanılmıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const readme=fs.readFileSync(path.join(ROOT,"README.md"),"utf8");
});


test("Klasik Mod geçmiş kaydı practice'e dönüştürülmeden korunuyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('["daily","practice","classic","shared"].includes(item?.mode)'));
});

test("Yarım Klasik Mod geri yüklenirken aktif satır seçilen harfin tahmin limitine göre sınırlandırılıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const start=app.indexOf("function restoreGame()");
  const end=app.indexOf("\nlet modalCloseAction",start);
  const block=app.slice(start,end);
  assert(block.includes("Math.min(currentAttemptLimit()-1"));
});

test("Klasik Mod sonuç paylaşımı oyunla aynı kırmızı geri bildirim rengini kullanıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const start=app.indexOf("function buildShareText(won,tries)");
  const end=app.indexOf("\nfunction shareIconSVG",start);
  const block=app.slice(start,end);
  assert(block.includes('red:"🟥"'));
  assert(!block.includes('red:"⬛"'));
});


test("Mobil ana sayfa 8 demo kutusunu kart genişliğine sığdırıyor",()=>{
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(css.includes("grid-template-columns:repeat(8,minmax(0,1fr))"));
  assert(css.includes("width:100%;min-width:0;height:auto;aspect-ratio:1"));
  assert(css.includes(".home-card{width:min(100%,520px);max-width:100%;margin-inline:auto}"));
});

test("Mobil modallar bottom sheet yerine ekran ortasında açılıyor",()=>{
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(css.includes("place-items:center"));
  assert(css.includes("border-radius:16px;overscroll-behavior:contain"));
  assert(!css.includes("border-radius:16px 16px 0 0;overscroll-behavior:contain"));
});

test("Sonuç Tebrikler başlığı kapatma butonu boşluğundan etkilenmiyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(app.includes('class="result-celebration"'));
  assert(css.includes("#modalBody > h2"));
  assert(css.includes(".result-hero h2{"));
  assert(css.includes("justify-content:center"));
});


test("Canlı maç saat güncellemesi tüm tahtayı 250 ms'de bir yeniden render etmiyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("function updateLiveClockUI()"));
  assert(app.includes("function liveRenderSignature(state)"));
  assert(app.includes("if(nextSignature!==previousSignature){"));
  assert(app.includes("if(liveMatchSession?.state?.id===id)updateLiveClockUI();"));
  assert(!app.includes("if(liveMatchSession?.state?.id===id)renderLiveMatch();\n  },250);"));
});

test("Online Klasik klavyesi feedback rengini, Kelimelik klavyesi kullanılan harfi koruyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(app.includes("function buildOnlineKeyboardState(mode,guesses)"));
  assert(app.includes("function onlineKeyboardClass(keyState,letter)"));
  assert(app.includes("liveKeyboardHTML(state)"));
  assert(css.includes(".live-key.used"));
  assert(css.includes(".live-key.feedback-green"));
  assert(css.includes(".live-key.feedback-yellow"));
  assert(css.includes(".live-key.feedback-red"));
});

test("Release audit migration profil tablo yazımını ve bitmiş maç reaction abuse'unu kapatıyor",()=>{
  const sql=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260816_006_release_audit_hardening.sql"),"utf8");
  assert(sql.includes("revoke create on schema public from public, anon, authenticated"));
  assert(sql.includes("revoke select, insert, update, delete on public.profiles from public, anon, authenticated"));
  assert(sql.includes("drop policy if exists \"owner can update own profile\" on public.profiles"));
  assert(sql.includes("Tepkiler yalnızca aktif maçta kullanılabilir"));
});

test("Online profil frontend dosyaları ve Supabase migration mevcut",()=>{
  const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
  const online=fs.readFileSync(path.join(ROOT,"src/js/online.js"),"utf8");
  const config=fs.readFileSync(path.join(ROOT,"src/js/online-config.js"),"utf8");
  const sql=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260815_001_online_foundation.sql"),"utf8");
  assert(html.includes('id="profileBtn"'));
  assert(html.includes('<script src="src/js/online-config.js"></script>'));
  assert(html.includes('<script src="src/js/online.js"></script>'));
  assert(online.includes('signInAnonymously'));
  assert(online.includes('rpc("ensure_profile"'));
  assert(config.includes('enabled:true'));
  assert(config.includes('https://ggezbkgqgzghygltqqsb.supabase.co'));
  assert(config.includes('sb_publishable_'));
  assert(sql.includes('create table if not exists public.profiles'));
  assert(sql.includes('alter table public.profiles enable row level security'));
});

test("Service role anahtarı frontend yapılandırmasına konmuyor",()=>{
  const config=fs.readFileSync(path.join(ROOT,"src/js/online-config.js"),"utf8");
  assert(!/service[_-]?role\s*[:=]\s*["'][A-Za-z0-9._-]{20,}/i.test(config));
  assert(config.includes('anonKey:"sb_publishable_'));
  assert(!/service[_-]?role/i.test(config.replace(/service_role \/ secret key KESİNLİKLE buraya yazılmamalıdır\./i,'')));
});

test("Çok Oyunculu kartı profil onboardingine açılıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('function showMultiplayerMenu()'));
  assert(app.includes('showProfileSetup({returnTo:showMultiplayerMenu,backTo:showNewGameSelector})'));
  assert(app.includes('$("#selectMultiplayerGame").onclick=showMultiplayerMenu'));
});

test("Multiplayer istatistik sekmesi Genel Kelimelik Klasik alt kırılımına sahip",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('data-stats-category="multiplayer"'));
  assert(app.includes('data-multiplayer-mode="overall"'));
  assert(app.includes('data-multiplayer-mode="kelimelik"'));
  assert(app.includes('data-multiplayer-mode="classic"'));
  assert(app.includes('function multiplayerStatsPanelHTML'));
});


test("Özel canlı oda menüsü gerçek create/join akışına bağlı",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const online=fs.readFileSync(path.join(ROOT,"src/js/online.js"),"utf8");
  assert(app.includes("function showFriendLiveSetup()"));
  assert(app.includes("ONLINE.createPrivateMatch(selectedMode,selectedLength)"));
  assert(app.includes("ONLINE.joinPrivateMatch(valid.roomCode)"));
  assert(online.includes('rpc("create_private_live_match"'));
  assert(online.includes('rpc("join_private_live_match"'));
});

test("Canlı oda linki cevabı değil yalnızca oda kodunu taşır",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('url.searchParams.set("oda",roomCode)'));
  assert(!app.includes('searchParams.set("kelime"'));
  assert(app.includes("function startLiveRoomFromUrl()"));
});

test("Canlı rakip tahtası yalnızca gönderilmiş guesses listesini render ediyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("function liveGuessesFor(state,playerId)"));
  assert(app.includes("Rakip bağlantısını kaybetti · ${left} sn"));
  assert(!app.includes("opponent.currentInput"));
});

test("Canlı maç reconnect, tepkiler ve rövanş istemci akışına sahip",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("if(stale<20000)return"));
  assert(app.includes('const LIVE_REACTIONS=["👍","👏","🔥","😅","😮","💀"]'));
  assert(app.includes("async function requestLiveRematch()"));
  assert(app.includes("ONLINE.claimDisconnectWin"));
});

test("Canlı maç backend migrationları secret RLS ve server-side tahmin RPC içeriyor",()=>{
  const schema=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260815_002_live_multiplayer.sql"),"utf8");
  const seed=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260815_003_multiplayer_word_seed.sql"),"utf8");
  assert(schema.includes("create table if not exists public.live_match_secrets"));
  assert(schema.includes("revoke all on public.live_match_secrets from anon, authenticated"));
  assert(schema.includes("function public.submit_live_guess"));
  assert(schema.includes("interval '20 seconds'"));
  assert(seed.includes("insert into public.multiplayer_guess_words"));
});


test("Hızlı Eşleşme gerçek kuyruk RPC akışına bağlı",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const online=fs.readFileSync(path.join(ROOT,"src/js/online.js"),"utf8");
  const sql=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260815_004_quick_match_bot.sql"),"utf8");
  assert(app.includes("function showQuickMatchSetup()"));
  assert(app.includes("ONLINE.enterQuickMatch(mode,length)"));
  assert(app.includes("ONLINE.pollQuickMatch()"));
  assert(app.includes("12 saniye içinde rakip bulunamazsa bot seçeneği açılır"));
  assert(online.includes('rpc("enter_quick_match"'));
  assert(sql.includes("create table if not exists public.quick_match_queue"));
  assert(sql.includes("order by abs(q.performance_score-my_score),q.joined_at"));
});

test("Bot rakip Efe Defne Atlas profilleriyle server-side maç kullanıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const online=fs.readFileSync(path.join(ROOT,"src/js/online.js"),"utf8");
  const sql=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260815_004_quick_match_bot.sql"),"utf8");
  for(const name of ["Efe","Defne","Atlas"])assert(app.includes(name));
  assert(app.includes('state.matchKind==="bot"'));
  assert(app.includes("ONLINE.submitBotGuess"));
  assert(online.includes('rpc("create_bot_match"'));
  assert(online.includes('rpc("advance_bot_match"'));
  assert(sql.includes("create table if not exists public.bot_match_secrets"));
  assert(sql.includes("when 'efe' then 5 + floor(random()*5)"));
  assert(sql.includes("when 'atlas' then 12 + floor(random()*9)"));
});

test("Bot gizli cevabı URL veya istemci state içinde açılmıyor",()=>{
  const sql=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260815_004_quick_match_bot.sql"),"utf8");
  assert(sql.includes("revoke all on public.bot_match_secrets from anon, authenticated"));
  assert(!/grant\s+select\s+on\s+public\.bot_match_secrets/i.test(sql));
  const stateFn=sql.slice(sql.indexOf("function public.get_bot_match_state"),sql.indexOf("function public.record_bot_match_stats"));
  assert(!stateFn.includes("answer_word"));
});

test("Quick canlı maç motorunu, bot ise normal oyun görünümünü kullanıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("await openLiveMatch(result.match)"));
  assert(app.includes("await openLiveMatch(await ONLINE.createBotMatch"));
  assert(app.includes('if(state.matchKind==="bot")'));
  assert(app.includes("renderBotMatchNormal"));
  assert(app.includes("botNormalBoardHTML"));
  assert(app.includes("botNormalKeyboardHTML"));
});


test("Paylaş menüsü mevcut bulmaca ve kendi bulmacanı oluştur akışlarını ayırıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("function showShareMenu()"));
  assert(app.includes("🔗 Mevcut Bulmacayı Gönder"));
  assert(app.includes("✏️ Kendi Bulmacanı Oluştur"));
  assert(app.includes("function showCustomPuzzleBuilder()"));
  assert(app.includes("ONLINE.createCustomPuzzle(mode,length,answer)"));
});

test("Özel bulmaca URL cevabı değil yalnızca server kodunu taşıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('`ozel-${clean}`'));
  assert(app.includes("startCustomPuzzleFromCode(puzzle.code)"));
  assert(!app.includes("?kelime="));
  const sql=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260815_005_custom_puzzle_social.sql"),"utf8");
  assert(sql.includes("create table if not exists public.custom_puzzle_secrets"));
  assert(sql.includes("revoke all on public.custom_puzzle_secrets from anon, authenticated"));
  assert(!/grant\s+select\s+on\s+public\.custom_puzzle_secrets/i.test(sql));
});

test("Özel bulmaca tahminleri backend RPC ile doğrulanıyor ve Kelimelik patternini saklıyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const online=fs.readFileSync(path.join(ROOT,"src/js/online.js"),"utf8");
  const sql=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260815_005_custom_puzzle_social.sql"),"utf8");
  assert(app.includes("ONLINE.submitCustomPuzzleGuess(state.puzzleCode,guess)"));
  assert(online.includes('rpc("submit_custom_puzzle_guess"'));
  assert(sql.includes("public_fb:=case when p.mode='kelimelik' then fb-'pattern' else fb end"));
  assert(sql.includes("public.multiplayer_guess_words"));
  assert(app.includes("function useCustomPuzzleHint()"));
  assert(online.includes('rpc("use_custom_puzzle_hint"'));
  assert(sql.includes("function public.use_custom_puzzle_hint"));
  assert(sql.includes(">=best_green"));
});

test("Public rakip profili ve ikili geçmiş canlı rakip adına bağlı",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const online=fs.readFileSync(path.join(ROOT,"src/js/online.js"),"utf8");
  const sql=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260815_005_custom_puzzle_social.sql"),"utf8");
  assert(app.includes("function showPublicPlayerProfile"));
  assert(app.includes('id="liveOpponentProfileBtn"'));
  assert(app.includes("ONLINE.getHeadToHead(code)"));
  assert(app.includes("İkili Geçmiş"));
  assert(app.includes("Profil açıkken heartbeat/realtime çalışmaya devam eder"));
  assert(online.includes('rpc("get_head_to_head"'));
  assert(sql.includes("function public.get_head_to_head"));
  assert(sql.includes("limit 5"));
});


test("Online menü kullanıcıya teknik aşama/kurulum rozetleri göstermiyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/style.css"),"utf8");
  assert(!app.includes("Online V1"));
  assert(!app.includes("Online kurulum gerekli"));
  assert(!app.includes('class="online-stage-badge"'));
  assert(!app.includes('stage-next'));
  assert(!css.includes('content:"2. aşama"'));
  assert(!app.includes('Canlı oda kodu hazır, fakat backend henüz bağlanmamış.'));
});

test("İlk online profil ekranı sade metin ve çarpı tabanlı geri navigasyonu içeriyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes('"Online oyunlar için önce bir takma ad seç."'));
  assert(!app.includes('placeholder="Örn. Bilgehan"'));
  assert(app.includes('function showProfileSetup({returnTo=null,editing=false,backTo=null}={})'));
  assert(!app.includes('id="profileSetupBackBtn"'));
  assert(app.includes('backTo:showNewGameSelector'));
  assert(!app.includes('id="multiplayerBackBtn"'));
});

test("Online bağlantı kapalıyken uyarı teknik backend bilgisi yerine kullanıcı dostu açıklama veriyor",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  assert(app.includes("Çevrimiçi Oyun Henüz Etkin Değil"));
  assert(app.includes("Günlük Bulmaca, Kelimelik Modu ve Klasik Mod oynanabilir."));
  // Profil altındaki online durum bilgi kutusu kaldırıldı.
  assert(!app.includes("Profil şu an bu cihazda hazır."));
  assert(!app.includes("Online profil bağlantısı aktif."));
  const section=app.slice(app.indexOf("function showOnlineSetupRequired"),app.indexOf("function showFriendLiveSetup"));
  assert(!/Supabase|backend|publishable|service_role/i.test(section));
});

test("Online Klasik mod tüm 4/5/6 uzunluklarında 5/6/7 tahmin kuralına sahip",()=>{
  const online=fs.readFileSync(path.join(ROOT,"src/js/online.js"),"utf8");
  const migration=fs.readFileSync(path.join(ROOT,"supabase/migrations/20260816_009_classic_lengths.sql"),"utf8");
  assert(online.includes("if(![4,5,6].includes(cleanLength))"));
  assert(migration.includes("attempt_limit in (5,6,7,8)"));
  assert(migration.includes("attempt_limit=word_length+1"));
  assert(migration.includes("attempts:=clean_length+1"));
});

test("Mobil online oyun X düğmesi oyun scroll alanından fiziksel olarak ayrıdır",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8");
  const css=fs.readFileSync(path.join(ROOT,"src/css/mobile-fixes.css"),"utf8");
  const index=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");

  assert(index.includes('id="liveModalClose"'));
  assert(index.includes('aria-label="Online oyunu kapat"'));
  assert(app.includes('const liveClose=$("#liveModalClose")'));
  assert(app.includes('regularClose.hidden=true'));
  assert(app.includes('liveClose.hidden=false'));
  assert(app.includes('const isActualOnlineGame=Boolean($("#liveMatchRoot"))'));
  assert(app.includes('const liveModalCloseButton=$("#liveModalClose")'));
  assert(css.includes('body>.live-modal-close-fixed'));
  assert(/<\/section>\s*<\/div>\s*(?:<!--[\s\S]*?-->\s*)?<button[^>]+id="liveModalClose"/.test(index));
  assert(!css.includes('.modal-backdrop>.live-modal-close-fixed'));
  assert(css.includes('position:fixed!important'));
  assert(css.includes('.live-match-modal.live-close-pinned>.modal-close{display:none!important}'));
  assert(!app.includes('--live-close-fixed-top'));
  assert(!app.includes('--live-close-fixed-left'));
  const pinBlock=app.slice(app.indexOf('function pinLiveModalCloseButton(){'),app.indexOf('function alignModalCloseButton(){'));
  assert(!pinBlock.includes('getBoundingClientRect'));
  assert(!pinBlock.includes('visualViewport'));
});

test("Dokümantasyon tek README dosyasında tutuluyor",()=>{
  for(const file of [
    "README.md",
    "assets/favicon.svg",
    "assets/icon-192.png",
    "assets/icon-512.png",
    "assets/social-card.png",
    "licenses/LICENSE-ZEMBEREK.txt"
  ]){
    assert(fs.existsSync(path.join(ROOT,file)),file);
  }

  assert(!fs.existsSync(path.join(ROOT,"docs")),"docs klasörü kaldırılmış olmalı");
  assert(!fs.existsSync(path.join(ROOT,"supabase/README.md")),"supabase README kaldırılmış olmalı");
});

if(!process.exitCode){
  console.log(`\n${passed} test geçti.`);
}
