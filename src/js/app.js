const ROWS=8,STATE_ORDER=["none","red","yellow","green"];
let COLS=5;

const CORE=window.KELIMELIK_CORE;
const ONLINE=window.KELIMELIK_ONLINE || null;
const WORD_POOLS=window.KELIMELIK_WORD_POOLS || {};
const ANSWER_POOL_VERSIONS=window.KELIMELIK_ANSWER_POOLS || {};
const DAILY_SERIES=window.KELIMELIK_DAILY_SERIES || [];

const CURRENT_ANSWER_VERSION="A3";
const RECENT_ANSWERS_KEY="kelimelik-recent-answers-v1";
const RECENT_ANSWER_WINDOW=24;
const DAILY_EPOCH="2026-08-14";

let WORDS=[];
let VALID_WORDS=new Set();
let ANSWER_WORDS=[];

let guesses=[];
let feedbacks=[];
let submitted=[];
let activeRow=0;
let activeCol=0;
let secretWord="";
let hintUsed=false;
let gameMode="practice";
let gameVariant="kelimelik";
let gameFinished=false;
let gameSeed="";
let gameAnswerVersion=CURRENT_ANSWER_VERSION;
let gameDailyVersion="";
let sharedPuzzleToken="";
let pendingResultTimer=null;
let gameRunId=0;
let gameStartedAt=0;
let gameElapsedBeforeStart=0;
let gameTimerInterval=null;

const SETTINGS_KEY="kelimelik-settings-v1";
const DAILY_PROGRESS_KEY="kelimelik-daily-progress-v1";
const SHARED_PLAY_KEY="kelimelik-shared-play-v1";
const MAX_SHARED_PLAYS=30;
const HISTORY_KEY="kelimelik-history-v1";
const FAVORITES_KEY="kelimelik-favorites-v1";
const MAX_HISTORY=50;

function isClassicVariant(){
  return gameVariant==="classic";
}

function classicAttemptLimit(length=COLS){
  const n=Number(length);
  return [4,5,6].includes(n) ? n+1 : 6;
}

function currentAttemptLimit(){
  return isClassicVariant() ? classicAttemptLimit(COLS) : 8;
}

function formatGameClock(totalSeconds=0){
  const safe=Math.max(0,Number(totalSeconds)||0);
  const minutes=Math.floor(safe/60);
  const seconds=safe%60;
  return `${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}`;
}

function gameModeLabelText(){
  if(gameMode==="daily")return "Günlük · 5 Harf";
  if(gameMode==="classic")return `Klasik · ${COLS} Harf`;
  if(gameMode==="shared")return `${isClassicVariant()?"Klasik":"Kelimelik"} · ${COLS} Harf`;
  return `Kelimelik · ${COLS} Harf`;
}

function currentGameElapsedSeconds(){
  const base=Math.max(0,Number(gameElapsedBeforeStart)||0);
  if(!gameStartedAt)return base;
  return base+Math.max(0,Math.floor((Date.now()-gameStartedAt)/1000));
}

function updateGameModeStrip(){
  const modeEl=$("#gameModeLabel");
  const timerEl=$("#gameTimerLabel");
  if(modeEl)modeEl.textContent=gameModeLabelText();
  if(timerEl)timerEl.textContent=formatGameClock(currentGameElapsedSeconds());
}

function stopGameTimer(){
  if(gameTimerInterval!==null){
    clearInterval(gameTimerInterval);
    gameTimerInterval=null;
  }
}

function startGameTimer(){
  stopGameTimer();
  gameStartedAt=Date.now();
  updateGameModeStrip();
  gameTimerInterval=setInterval(updateGameModeStrip,1000);
}

function pauseGameTimer(){
  if(gameStartedAt){
    gameElapsedBeforeStart=currentGameElapsedSeconds();
    gameStartedAt=0;
  }
  stopGameTimer();
  updateGameModeStrip();
}

const TDK_WORD_CACHE_KEY="kelimelik-tdk-word-pool-v1";
const TDK_WORD_CACHE_MAX_AGE=7*24*60*60*1000;

function normalizeTdkGameWord(value){
  return String(value||"")
    .trim()
    .replace(/[âÂ]/g,"a")
    .replace(/[îÎ]/g,"i")
    .replace(/[ûÛ]/g,"u")
    .toLocaleUpperCase("tr-TR");
}

function splitTdkWords(values){
  const result={"4":[],"5":[],"6":[]};
  const seen={"4":new Set(),"5":new Set(),"6":new Set()};

  for(const value of values||[]){
    const word=normalizeTdkGameWord(value);
    const key=String(word.length);
    if(!seen[key] || !/^[A-ZÇĞİÖŞÜ]+$/.test(word) || seen[key].has(word))continue;
    seen[key].add(word);
    result[key].push(word);
  }

  for(const key of ["4","5","6"]){
    result[key].sort((a,b)=>a.localeCompare(b,"tr"));
  }
  return result;
}

function applyCanonicalTdkPools(pools){
  if(!pools || !["4","5","6"].every(k=>Array.isArray(pools[k]) && pools[k].length))return false;

  for(const key of ["4","5","6"]){
    WORD_POOLS[key]=[...pools[key]];
  }

  const base=ANSWER_POOL_VERSIONS.A2 || ANSWER_POOL_VERSIONS.A1 || {};
  ANSWER_POOL_VERSIONS.A3=Object.fromEntries(
    ["4","5","6"].map(key=>{
      const allowed=new Set(WORD_POOLS[key]);
      const answers=[...new Set((base[key]||[]).map(normalizeTdkGameWord))]
        .filter(word=>allowed.has(word));
      return [key,answers];
    })
  );
  return true;
}

function loadCachedTdkPools(){
  try{
    const saved=JSON.parse(localStorage.getItem(TDK_WORD_CACHE_KEY)||"null");
    if(!saved?.savedAt || Date.now()-Number(saved.savedAt)>TDK_WORD_CACHE_MAX_AGE)return null;
    return saved.pools || null;
  }catch(e){
    return null;
  }
}

function saveCachedTdkPools(pools){
  try{
    localStorage.setItem(TDK_WORD_CACHE_KEY,JSON.stringify({savedAt:Date.now(),pools}));
  }catch(e){}
}

async function fetchTextWithTimeout(url,timeoutMs=6500){
  const controller=typeof AbortController!=="undefined" ? new AbortController() : null;
  const timer=controller ? setTimeout(()=>controller.abort(),timeoutMs) : null;
  try{
    const response=await fetch(url,{cache:"no-store",credentials:"omit",signal:controller?.signal});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return await response.text();
  }finally{
    if(timer)clearTimeout(timer);
  }
}

async function hydrateTdkWordPools(){
  const cached=loadCachedTdkPools();
  if(cached && applyCanonicalTdkPools(cached))return true;

  try{
    const raw=await fetchTextWithTimeout("https://sozluk.gov.tr/autocomplete.json",5500);
    const data=JSON.parse(raw);
    const pools=splitTdkWords(Array.isArray(data)?data.map(item=>item?.madde):[]);
    if(applyCanonicalTdkPools(pools)){
      saveCachedTdkPools(pools);
      return true;
    }
  }catch(error){
    console.warn("TDK kelime listesi doğrudan alınamadı:",error);
  }

  try{
    const raw=await fetchTextWithTimeout(
      "https://raw.githubusercontent.com/ncarkaci/TDKDictionaryCrawler/master/TDK_S%C3%B6zl%C3%BCk_Kelime_Listesi.txt",
      6500
    );
    const pools=splitTdkWords(raw.split(/\r?\n/));
    if(applyCanonicalTdkPools(pools)){
      saveCachedTdkPools(pools);
      return true;
    }
  }catch(error){
    console.warn("TDK yedek kelime listesi alınamadı:",error);
  }

  // Çevrimdışı açılışta oyun yine çalışsın; yeni oyun sürümü yerel A2 havuzunun
  // mevcut tahmin sözlüğüyle kesişiminden üretilir.
  applyCanonicalTdkPools(WORD_POOLS);
  return false;
}

function setWordLength(length,answerVersion=CURRENT_ANSWER_VERSION){
  COLS=length;
  WORDS=[...new Set((WORD_POOLS[String(length)] || [])
    .map(w=>String(w).trim().toLocaleUpperCase("tr-TR"))
    .filter(w=>w.length===length))];

  VALID_WORDS=new Set(WORDS);

  const versionPool=ANSWER_POOL_VERSIONS?.[answerVersion]?.[String(length)] || [];
  const balanced=versionPool.filter(w=>VALID_WORDS.has(w));

  if(!balanced.length){
    throw new Error(`Cevap havuzu yüklenemedi: ${answerVersion}/${length}`);
  }

  gameAnswerVersion=answerVersion;
  ANSWER_WORDS=balanced;
}

const STATS_KEY="kelimelik-stats-v2";
const LEGACY_STATS_KEY="word500-stats-v1";
const DAILY_KEY="kelimelik-daily-v2";
const MULTIPLAYER_STATS_KEY="kelimelik-multiplayer-stats-v1";

function emptyMultiplayerStatBucket(){
  return {
    matches:0,wins:0,losses:0,draws:0,currentStreak:0,maxStreak:0,
    solvedMatches:0,totalSolveGuesses:0,totalSolveMs:0
  };
}

function defaultMultiplayerStats(){
  return {
    overall:emptyMultiplayerStatBucket(),
    kelimelik:emptyMultiplayerStatBucket(),
    classic:emptyMultiplayerStatBucket()
  };
}

function normalizeMultiplayerBucket(bucket){
  const clean={...emptyMultiplayerStatBucket(),...(bucket||{})};
  for(const key of Object.keys(clean)){
    clean[key]=Math.max(0,Number(clean[key])||0);
  }
  return clean;
}

function loadMultiplayerStats(){
  try{
    const raw=JSON.parse(localStorage.getItem(MULTIPLAYER_STATS_KEY)||"null");
    if(!raw)return defaultMultiplayerStats();
    return {
      overall:normalizeMultiplayerBucket(raw.overall),
      kelimelik:normalizeMultiplayerBucket(raw.kelimelik),
      classic:normalizeMultiplayerBucket(raw.classic)
    };
  }catch(e){
    return defaultMultiplayerStats();
  }
}

function saveMultiplayerStats(stats){
  storageSet(MULTIPLAYER_STATS_KEY,JSON.stringify(stats));
}


const $=s=>document.querySelector(s);
const board=$("#board"),keyboard=$("#keyboard"),
modalBackdrop=$("#modalBackdrop"),modalBody=$("#modalBody");

function storageSet(key,value){
  try{
    localStorage.setItem(key,value);
    return true;
  }catch(e){
    console.warn("Tarayıcı depolamasına yazılamadı:",key);
    return false;
  }
}

function storageRemove(key){
  try{
    localStorage.removeItem(key);
    return true;
  }catch(e){
    return false;
  }
}

function normalizeStoredWord(value){
  const word=String(value||"").trim().toLocaleUpperCase("tr-TR");
  return /^[A-ZÇĞİÖŞÜ]{4,6}$/.test(word) ? word : "";
}

function emptyRows(){
  return Array.from({length:ROWS},
    ()=>Array.from({length:COLS},()=>({letter:"",state:"none"})));
}

function loadSharedPlays(){
  try{
    const data=JSON.parse(localStorage.getItem(SHARED_PLAY_KEY)||"{}");
    return data && typeof data==="object" && !Array.isArray(data) ? data : {};
  }catch(e){
    return {};
  }
}

function saveSharedPlays(plays){
  const entries=Object.entries(plays||{})
    .sort((a,b)=>Number(b[1]?.updatedAt||0)-Number(a[1]?.updatedAt||0))
    .slice(0,MAX_SHARED_PLAYS);

  storageSet(SHARED_PLAY_KEY,JSON.stringify(Object.fromEntries(entries)));
}

function getSharedPlay(token){
  return loadSharedPlays()[String(token||"")] || null;
}

function saveSharedPlay(token,state){
  const key=String(token||"");
  if(!key)return;

  const plays=loadSharedPlays();
  plays[key]={
    ...(plays[key]||{}),
    ...(state||{}),
    token:key,
    updatedAt:Date.now()
  };
  saveSharedPlays(plays);
}

function sharedPuzzleCompleted(token){
  return Boolean(getSharedPlay(token)?.completed);
}

function todayKey(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function formatDateTR(dateKey=todayKey()){
  const match=String(dateKey||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match)return String(dateKey||"");
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function previousDateKey(dateKey){
  const [y,m,d]=dateKey.split("-").map(Number);
  const dt=new Date(y,m-1,d);
  dt.setDate(dt.getDate()-1);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
}

function emptyStatBucket(){
  return {
    gamesPlayed:0,
    wins:0,
    currentStreak:0,
    maxStreak:0,
    guessDistribution:[0,0,0,0,0,0,0,0],
    totalWinningGuesses:0,
    bestWin:null,
    lastPlayedDate:null
  };
}

function defaultStats(){
  return {
    overall:emptyStatBucket(),
    daily:emptyStatBucket(),
    classic:{
      "4":emptyStatBucket(),
      "5":emptyStatBucket(),
      "6":emptyStatBucket()
    },
    classicMode:emptyStatBucket()
  };
}

function normalizeBucket(bucket){
  const clean={...emptyStatBucket(),...(bucket||{})};

  if(!Array.isArray(clean.guessDistribution) || clean.guessDistribution.length!==8){
    clean.guessDistribution=[0,0,0,0,0,0,0,0];
  }

  const distributionWins=clean.guessDistribution.reduce((sum,n)=>sum+(Number(n)||0),0);
  const derivedTotal=clean.guessDistribution.reduce(
    (sum,n,index)=>sum+(Number(n)||0)*(index+1),0
  );
  const derivedBestIndex=clean.guessDistribution.findIndex(n=>(Number(n)||0)>0);

  clean.totalWinningGuesses=Number(clean.totalWinningGuesses)||derivedTotal;
  clean.bestWin=Number.isFinite(Number(clean.bestWin)) && clean.bestWin!==null
    ? Number(clean.bestWin)
    : (derivedBestIndex>=0 ? derivedBestIndex+1 : null);
  clean.hasDetailedGuessData=distributionWins>0 || clean.wins===0;

  return clean;
}

function loadStats(){
  try{
    const current=JSON.parse(localStorage.getItem(STATS_KEY)||"null");
    if(current){
      return {
        overall:normalizeBucket(current.overall),
        daily:normalizeBucket(current.daily),
        classic:{
          "4":normalizeBucket(current.classic?.["4"]),
          "5":normalizeBucket(current.classic?.["5"]),
          "6":normalizeBucket(current.classic?.["6"])
        },
        classicMode:normalizeBucket(current.classicMode)
      };
    }

    /* Önceki sürümdeki toplu istatistiği kaybetmeyelim:
       sadece Genel sekmesine bir kez aktarılır. */
    const legacy=JSON.parse(localStorage.getItem(LEGACY_STATS_KEY)||"null");
    if(legacy){
      const migrated=defaultStats();
      migrated.overall=normalizeBucket(legacy);
      saveStats(migrated);
      return migrated;
    }
  }catch(e){
    console.warn("İstatistik kaydı okunamadı:",e);
  }
  return defaultStats();
}

function saveStats(stats){
  storageSet(STATS_KEY,JSON.stringify(stats));
}

function loadDailyRecord(){
  try{
    const current=JSON.parse(localStorage.getItem(DAILY_KEY)||"null");
    if(current)return current;

    /* Eski günlük kaydını da tanı. */
    const legacy=JSON.parse(localStorage.getItem("word500-daily-v1")||"null");
    if(legacy)return legacy;
  }catch(e){}
  return null;
}

function saveDailyRecord(record){
  storageSet(DAILY_KEY,JSON.stringify(record));
}

function localDateKeyFromValue(value){
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return "";
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function dailyHistoryResultForDate(dateKey){
  const key=`daily:${dateKey}`;
  const entries=loadHistory().filter(item=>
    item?.puzzleKey===key ||
    (item?.mode==="daily" && localDateKeyFromValue(item.date)===dateKey)
  );
  return entries.find(item=>item.won) || entries[0] || null;
}

function todayDailyHistoryResult(){
  return dailyHistoryResultForDate(todayKey());
}

function todayDailySavedGameResult(){
  try{
    const saved=JSON.parse(localStorage.getItem("kelimelik-game-v18")||"null");
    if(
      !saved ||
      saved.gameMode!=="daily" ||
      saved.gameSeed!==todayKey() ||
      !saved.gameFinished ||
      !saved.secretWord ||
      !Array.isArray(saved.guesses)
    ){
      return null;
    }

    const winIndex=saved.guesses.findIndex((row,index)=>{
      if(!saved.submitted?.[index])return false;
      const word=Array.isArray(row)
        ? row.map(cell=>String(cell?.letter||"")).join("")
        : "";
      return word===saved.secretWord;
    });

    return {
      mode:"daily",
      won:winIndex>=0,
      tries:winIndex>=0 ? winIndex+1 : null,
      word:saved.secretWord,
      date:new Date().toISOString()
    };
  }catch(e){
    return null;
  }
}

function todayDailyEvidenceResult(){
  const history=todayDailyHistoryResult();
  if(history?.won)return history;

  const saved=todayDailySavedGameResult();
  if(saved?.won)return saved;

  return history || saved || null;
}

function repairDailyStatsWinFromEvidence(tries){
  if(!(tries>=1 && tries<=8))return;

  const stats=loadStats();
  const bucket=stats.daily;

  if(!bucket || Number(bucket.gamesPlayed)<=0)return;
  if(Number(bucket.wins)>0)return;

  /* Eski bir sürüm bugünün kazanılan günlük oyununu kayıp gibi
     işaretlediyse mevcut oyunu ikinci kez saymadan sonucu düzelt. */
  bucket.wins=1;
  bucket.currentStreak=Math.max(1,Number(bucket.currentStreak)||0);
  bucket.maxStreak=Math.max(Number(bucket.maxStreak)||0,bucket.currentStreak);

  bucket.guessDistribution=Array.isArray(bucket.guessDistribution)
    ? bucket.guessDistribution
    : Array(8).fill(0);

  bucket.guessDistribution[tries-1]=Math.max(
    1,
    Number(bucket.guessDistribution[tries-1])||0
  );

  bucket.totalWinningGuesses=Math.max(
    tries,
    Number(bucket.totalWinningGuesses)||0
  );

  bucket.bestWin=bucket.bestWin===null || bucket.bestWin===undefined
    ? tries
    : Math.min(Number(bucket.bestWin)||tries,tries);

  bucket.hasDetailedGuessData=true;
  bucket.lastPlayedDate=todayKey();
  saveStats(stats);
}

function repairTodayDailyState(){
  const record=loadDailyRecord();
  if(!record || record.date!==todayKey() || !record.completed)return record;

  const evidence=todayDailyEvidenceResult();
  let changed=false;
  let repairedWin=false;
  const next={...record};

  if(evidence?.won && next.won!==true){
    next.won=true;
    next.tries=Number(evidence.tries)||next.tries||null;
    repairedWin=true;
    changed=true;
  }

  if(!next.word){
    next.word=evidence?.word || getDailyPuzzleInfo().word;
    changed=true;
  }

  if(next.won && !next.tries && evidence?.tries){
    next.tries=Number(evidence.tries)||null;
    changed=true;
  }

  if(changed)saveDailyRecord(next);
  if(repairedWin)repairDailyStatsWinFromEvidence(Number(next.tries));

  return next;
}

function getTodayDailySummary(){
  const record=repairTodayDailyState();
  const evidence=todayDailyEvidenceResult();

  const completed=Boolean(
    record &&
    record.date===todayKey() &&
    record.completed
  );

  const won=Boolean(
    completed &&
    (record?.won || evidence?.won)
  );

  const tries=won
    ? Number(record?.tries || evidence?.tries) || null
    : null;

  const word=won
    ? String(record?.word || evidence?.word || getDailyPuzzleInfo().word || "")
    : "";

  return {
    completed,
    won,
    tries,
    word,
    date:todayKey()
  };
}

function dailyPlayedToday(){
  const record=loadDailyRecord();
  return Boolean(record && record.date===todayKey() && record.completed);
}

function loadDailyProgress(){
  try{
    const progress=JSON.parse(localStorage.getItem(DAILY_PROGRESS_KEY)||"null");
    if(!progress)return null;

    if(progress.date!==todayKey() || progress.gameMode!=="daily" || progress.gameFinished){
      storageRemove(DAILY_PROGRESS_KEY);
      return null;
    }

    return progress;
  }catch(e){
    storageRemove(DAILY_PROGRESS_KEY);
    return null;
  }
}

function clearDailyProgress(){
  storageRemove(DAILY_PROGRESS_KEY);
}

function restoreDailyProgress(){
  const saved=loadDailyProgress();
  if(!saved)return false;

  try{
    const dailyInfo=getDailyPuzzleInfo();
    if(Number(saved.COLS)!==5)throw new Error("Günlük kayıt uzunluğu geçersiz");
    if(saved.secretWord!==dailyInfo.word)throw new Error("Günlük cevap değişmiş");
    if(saved.gameSeed!==todayKey())throw new Error("Günlük kayıt tarihi geçersiz");
    if(!Array.isArray(saved.guesses) || saved.guesses.length!==ROWS){
      throw new Error("Günlük tahmin kaydı geçersiz");
    }

    setWordLength(5,CURRENT_ANSWER_VERSION);
    guesses=saved.guesses;
    feedbacks=Array.isArray(saved.feedbacks)
      ? saved.feedbacks
      : Array.from({length:ROWS},()=>null);
    submitted=Array.isArray(saved.submitted)
      ? saved.submitted
      : Array(ROWS).fill(false);
    activeRow=Math.max(0,Math.min(ROWS-1,Number(saved.activeRow)||0));
    activeCol=Math.max(0,Math.min(COLS,Number(saved.activeCol)||0));
    secretWord=saved.secretWord;
    hintUsed=Boolean(saved.hintUsed);
    gameMode="daily";
    gameVariant="kelimelik";
    gameFinished=false;
    gameSeed=todayKey();
    gameAnswerVersion=CURRENT_ANSWER_VERSION;
    gameDailyVersion=typeof saved.gameDailyVersion==="string"
      ? saved.gameDailyVersion
      : dailyInfo.version;
    gameElapsedBeforeStart=Math.max(0,Number(saved.gameElapsedSeconds)||0);
    stopGameTimer();
    return true;
  }catch(e){
    clearDailyProgress();
    return false;
  }
}

function updateStatBucket(bucket,won,tries,{daily=false}={}){
  return CORE.updateStatBucket(bucket,won,tries,{
    daily,
    today:todayKey()
  });
}

function recordGameResult(won,tries){
  if(gameFinished)return;
  gameFinished=true;
  pauseGameTimer();

  const stats=loadStats();
  updateStatBucket(stats.overall,won,tries);

  if(gameMode==="daily"){
    updateStatBucket(stats.daily,won,tries,{daily:true});
    const dailyInfo=getDailyPuzzleInfo();
    saveDailyRecord({
      date:todayKey(),
      completed:true,
      won:Boolean(won),
      tries:won?tries:null,
      word:secretWord,
      puzzleNumber:dailyInfo.number,
      dailyVersion:dailyInfo.version
    });
    clearDailyProgress();
  }else if(gameMode==="practice"){
    const key=String(COLS);
    if(stats.classic[key]){
      updateStatBucket(stats.classic[key],won,tries);
    }
  }else if(gameMode==="classic"){
    updateStatBucket(stats.classicMode,won,tries);
  }else if(gameMode==="shared" && sharedPuzzleToken){
    saveSharedPlay(sharedPuzzleToken,{
      completed:true,
      won:Boolean(won),
      tries:won?tries:null,
      word:secretWord,
      length:COLS,
      gameVariant,
      attemptLimit:currentAttemptLimit(),
      gameFinished:true,
      completedAt:new Date().toISOString()
    });
  }

  saveStats(stats);
  recordHistoryEntry(won,tries);
  if(gameMode==="practice" || gameMode==="classic"){
    rememberRecentAnswer(secretWord,COLS);
  }
  saveGame();
}


function defaultSettings(){
  return {animations:true,colorBlind:false};
}

function loadSettings(){
  try{
    const saved=JSON.parse(localStorage.getItem(SETTINGS_KEY)||"{}");
    return {
      animations:saved?.animations!==false,
      colorBlind:Boolean(saved?.colorBlind)
    };
  }catch(e){
    return defaultSettings();
  }
}

function saveSettings(settings){
  const clean={
    animations:settings?.animations!==false,
    colorBlind:Boolean(settings?.colorBlind)
  };
  storageSet(SETTINGS_KEY,JSON.stringify(clean));
  applySettings(clean);
}

function applySettings(settings=loadSettings()){
  /* Tema seçimi kaldırıldı. Eski kaydedilmiş tema değerleri artık uygulanmaz. */
  delete document.documentElement.dataset.theme;

  /* Animasyon ayarı yalnızca oyun alanını etkiler.
     Ana sayfa animasyonları her zaman aktif kalır. */
  const gameScreen=document.getElementById("gameScreen");
  if(gameScreen){
    gameScreen.classList.toggle("reduce-motion",!settings.animations);
  }

  document.documentElement.classList.toggle("color-blind",Boolean(settings.colorBlind));
}

function historyPuzzleKey(item){
  const explicit=String(item?.puzzleKey||"").trim();
  if(explicit)return explicit;

  const mode=String(item?.mode||"");
  const dateKey=localDateKeyFromValue(item?.date);

  if(mode==="daily" && dateKey){
    return `daily:${dateKey}`;
  }

  const token=String(item?.sharedPuzzleToken||"").trim();
  const sharedDaily=token.match(/^gunluk-(\d{4}-\d{2}-\d{2})$/i);
  if(sharedDaily){
    return `daily:${sharedDaily[1]}`;
  }

  const sharedDirect=token.match(/^klasikmod-([456])-(A\d+)-([A-Z0-9]{1,8})$/i);
  if(sharedDirect){
    return `classicmode:${sharedDirect[1]}:${sharedDirect[2].toUpperCase()}:${sharedDirect[3].toUpperCase()}`;
  }

  const sharedClassic=token.match(/^klasik-([456])-(A\d+)-([A-Z0-9]{1,8})$/i);
  if(sharedClassic){
    return `classic:${sharedClassic[1]}:${sharedClassic[2].toUpperCase()}:${sharedClassic[3].toUpperCase()}`;
  }

  if(mode==="classic" && item?.gameSeed){
    return `classicmode:${Number(item.length)||String(item.word||"").length}:${String(item.gameAnswerVersion||CURRENT_ANSWER_VERSION)}:${String(item.gameSeed).toUpperCase()}`;
  }

  if(mode==="practice" && item?.gameSeed){
    return `classic:${Number(item.length)||String(item.word||"").length}:${String(item.gameAnswerVersion||CURRENT_ANSWER_VERSION)}:${String(item.gameSeed).toUpperCase()}`;
  }

  return "";
}

function canonicalHistoryEntry(item){
  const word=normalizeStoredWord(item?.word);
  if(!word)return null;

  const mode=["daily","practice","classic","shared"].includes(item?.mode)
    ? item.mode
    : "practice";
  const tries=Number(item?.tries);

  const clean={
    id:String(item?.id||""),
    word,
    length:word.length,
    mode,
    won:Boolean(item?.won),
    tries:Number.isInteger(tries) && tries>=1 && tries<=8 ? tries : null,
    date:String(item?.date||""),
    gameSeed:String(item?.gameSeed||""),
    gameAnswerVersion:String(item?.gameAnswerVersion||""),
    sharedPuzzleToken:String(item?.sharedPuzzleToken||""),
    gameVariant:item?.gameVariant==="classic" ? "classic" : "kelimelik",
    attemptLimit:[5,6,7,8].includes(Number(item?.attemptLimit)) ? Number(item.attemptLimit) : 8,
    puzzleKey:String(item?.puzzleKey||"")
  };

  if(clean.mode==="classic"){
    clean.gameVariant="classic";
    clean.attemptLimit=classicAttemptLimit(clean.length);
  }

  if(clean.mode==="shared" && clean.sharedPuzzleToken){
    const parsed=parsePuzzleShareToken(clean.sharedPuzzleToken);
    if(parsed?.mode==="classic"){
      clean.gameVariant="classic";
      clean.attemptLimit=classicAttemptLimit(parsed.length||clean.length);
    }
  }

  clean.puzzleKey=historyPuzzleKey(clean);
  return clean;
}

function mergeHistoryEntries(a,b){
  const won=Boolean(a.won || b.won);
  const winningTries=[a.tries,b.tries]
    .filter(n=>Number.isInteger(n) && n>=1 && n<=8);
  const tries=won && winningTries.length ? Math.min(...winningTries) : null;
  const winner=a.won ? a : b.won ? b : a;
  const key=a.puzzleKey || b.puzzleKey;
  const daily=String(key||"").startsWith("daily:");

  return {
    ...winner,
    id:a.id || b.id,
    word:winner.word || a.word || b.word,
    length:winner.length || a.length || b.length,
    mode:daily ? "daily" : (a.mode==="practice" ? "practice" : b.mode),
    won,
    tries,
    date:a.date || b.date,
    gameSeed:a.gameSeed || b.gameSeed,
    gameAnswerVersion:a.gameAnswerVersion || b.gameAnswerVersion,
    sharedPuzzleToken:a.sharedPuzzleToken || b.sharedPuzzleToken,
    gameVariant:(a.gameVariant==="classic" || b.gameVariant==="classic") ? "classic" : "kelimelik",
    attemptLimit:Number(winner.attemptLimit)||Number(a.attemptLimit)||Number(b.attemptLimit)||8,
    puzzleKey:key
  };
}

function repairHistoryEntries(entries){
  const dailyRecord=loadDailyRecord();
  const normalized=entries.map(canonicalHistoryEntry).filter(Boolean);

  normalized.forEach(item=>{
    if(
      item.mode==="shared" &&
      !item.puzzleKey &&
      dailyRecord?.date &&
      dailyRecord?.word &&
      localDateKeyFromValue(item.date)===dailyRecord.date &&
      item.word===normalizeStoredWord(dailyRecord.word)
    ){
      item.puzzleKey=`daily:${dailyRecord.date}`;
    }
  });

  const byKey=new Map();
  const unkeyed=[];

  normalized.forEach(item=>{
    if(!item.puzzleKey){
      unkeyed.push(item);
      return;
    }
    const existing=byKey.get(item.puzzleKey);
    byKey.set(item.puzzleKey,existing?mergeHistoryEntries(existing,item):item);
  });

  return [...byKey.values(),...unkeyed]
    .sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0))
    .slice(0,MAX_HISTORY);
}

function loadHistory(){
  try{
    const data=JSON.parse(localStorage.getItem(HISTORY_KEY)||"[]");
    if(!Array.isArray(data))return [];

    const repaired=repairHistoryEntries(data);
    const original=JSON.stringify(data.slice(0,MAX_HISTORY));
    const next=JSON.stringify(repaired);

    if(original!==next){
      storageSet(HISTORY_KEY,next);
    }

    return repaired;
  }catch(e){
    return [];
  }
}

function saveHistory(history){
  const repaired=repairHistoryEntries(Array.isArray(history)?history:[]);
  storageSet(HISTORY_KEY,JSON.stringify(repaired.slice(0,MAX_HISTORY)));
}

function loadFavorites(){
  try{
    const data=JSON.parse(localStorage.getItem(FAVORITES_KEY)||"[]");
    const words=Array.isArray(data)
      ? data.map(normalizeStoredWord).filter(Boolean)
      : [];
    return new Set(words);
  }catch(e){
    return new Set();
  }
}

function saveFavorites(favorites){
  storageSet(FAVORITES_KEY,JSON.stringify([...favorites].sort()));
}

function isFavorite(word){
  return loadFavorites().has(word);
}

function toggleFavorite(word){
  const favorites=loadFavorites();
  if(favorites.has(word))favorites.delete(word);
  else favorites.add(word);
  saveFavorites(favorites);
  return favorites.has(word);
}

function randomSeed(){
  if(window.crypto?.getRandomValues){
    const values=new Uint32Array(2);
    window.crypto.getRandomValues(values);
    return `${values[0].toString(36)}${values[1].toString(36)}`
      .slice(0,8).toUpperCase();
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`
    .replace(/[^a-z0-9]/gi,"")
    .slice(0,8)
    .toUpperCase();
}

function buildGameCode(length,seed,answerVersion=gameAnswerVersion){
  return CORE.buildGameCode(length,seed,answerVersion);
}

function parseGameCode(code){
  return CORE.parseGameCode(code);
}

function chooseSeededSecret(seed,answerVersion=gameAnswerVersion){
  return CORE.chooseSeededWord(
    ANSWER_POOL_VERSIONS,
    answerVersion,
    COLS,
    seed
  );
}

function loadRecentAnswers(length=COLS){
  try{
    const stored=JSON.parse(localStorage.getItem(RECENT_ANSWERS_KEY)||"{}");
    const key=String(length);
    return Array.isArray(stored?.[key])
      ? stored[key].map(normalizeStoredWord).filter(Boolean).slice(0,RECENT_ANSWER_WINDOW)
      : [];
  }catch(e){
    return [];
  }
}

function rememberRecentAnswer(word,length=COLS){
  const clean=normalizeStoredWord(word);
  if(!clean)return;
  try{
    const stored=JSON.parse(localStorage.getItem(RECENT_ANSWERS_KEY)||"{}");
    const base=stored && typeof stored==="object" && !Array.isArray(stored) ? stored : {};
    const key=String(length);
    const current=Array.isArray(base[key]) ? base[key] : [];
    base[key]=[clean,...current.filter(item=>normalizeStoredWord(item)!==clean)]
      .slice(0,RECENT_ANSWER_WINDOW);
    storageSet(RECENT_ANSWERS_KEY,JSON.stringify(base));
  }catch(e){}
}

function chooseFreshRandomSecret(answerVersion=gameAnswerVersion){
  const recent=new Set(loadRecentAnswers(COLS));
  let fallback=null;
  for(let attempt=0;attempt<96;attempt++){
    const seed=randomSeed();
    const word=chooseSeededSecret(seed,answerVersion);
    if(!fallback)fallback={seed,word};
    if(!recent.has(word))return {seed,word};
  }
  if(fallback)return fallback;
  const seed=randomSeed();
  return {seed,word:chooseSeededSecret(seed,answerVersion)};
}

const TDK_API_BASE="https://sozluk.gov.tr/gts?ara=";

function dictionaryUrl(word){
  /* Only used as a graceful fallback if the API request cannot be read. */
  return `https://sozluk.gov.tr/?ara=${encodeURIComponent(
    word.toLocaleLowerCase("tr-TR")
  )}`;
}

function tdkApiUrl(word){
  return `${TDK_API_BASE}${encodeURIComponent(
    word.toLocaleLowerCase("tr-TR")
  )}`;
}

function escapeHTML(value){
  return String(value??"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function extractTdkMeanings(payload){
  if(!Array.isArray(payload))return [];

  const meanings=[];

  payload.forEach(entry=>{
    if(!entry || !Array.isArray(entry.anlamlarListe))return;

    entry.anlamlarListe.forEach(item=>{
      const text=String(item?.anlam || "").trim();
      if(text && !meanings.includes(text))meanings.push(text);
    });
  });

  return meanings.slice(0,8);
}

async function fetchTdkMeaning(word){
  const controller=typeof AbortController!=="undefined"
    ? new AbortController()
    : null;

  const timeout=controller
    ? setTimeout(()=>controller.abort(),7000)
    : null;

  try{
    const response=await fetch(tdkApiUrl(word),{
      method:"GET",
      mode:"cors",
      credentials:"omit",
      cache:"no-store",
      signal:controller?.signal
    });

    if(!response.ok)throw new Error(`TDK HTTP ${response.status}`);

    const payload=await response.json();
    const meanings=extractTdkMeanings(payload);

    if(!meanings.length)throw new Error("TDK anlam bulunamadı.");
    return meanings;
  }finally{
    if(timeout)clearTimeout(timeout);
  }
}

async function showWordMeaning(word,{backAction=null}={}){
  const safeWord=escapeHTML(word);

  showModal(`
    <div class="meaning-modal">
      <span class="meaning-source">TDK Güncel Türkçe Sözlük</span>
      <h2>${safeWord}</h2>
      <div class="meaning-loading" id="meaningContent">
        <span class="meaning-spinner" aria-hidden="true"></span>
        Anlam yükleniyor…
      </div>
    </div>
  `,{closeAction:backAction});

  try{
    const meanings=await fetchTdkMeaning(word);

    const content=$("#meaningContent");
    if(!content)return;

    content.className="meaning-content";
    content.innerHTML=`
      <ol class="meaning-list">
        ${meanings.map(item=>`<li>${escapeHTML(item)}</li>`).join("")}
      </ol>
      <p class="meaning-credit">Kaynak: Türk Dil Kurumu</p>
    `;
  }catch(error){
    const content=$("#meaningContent");
    if(!content)return;

    content.className="meaning-content";
    content.innerHTML=`
      <p>TDK anlamı şu anda uygulama içinde yüklenemedi.</p>
      <a class="compact-action meaning-fallback"
         href="${dictionaryUrl(word)}"
         target="_blank"
         rel="noopener noreferrer">TDK Sözlük'te Aç ↗</a>
    `;
  }
}

function reportWordUrl(word){
  const subject=encodeURIComponent(`Kelimelik kelime bildirimi: ${word}`);
  const body=encodeURIComponent(
`Merhaba,

Kelimelik'te şu kelimeyi bildirmek istiyorum:

Kelime: ${word}
Mod: ${gameMode==="daily"
  ? "Günlük"
  : gameMode==="classic" || isClassicVariant()
    ? "Klasik Mod"
    : `Kelimelik Modu ${COLS} Harf`}

Neden:
`
  );

  return `mailto:bilgehanakbas0@gmail.com?subject=${subject}&body=${body}`;
}

function currentHistoryPuzzleKey(){
  if(gameMode==="daily"){
    return `daily:${gameSeed||todayKey()}`;
  }

  if(gameMode==="shared" && sharedPuzzleToken){
    const puzzle=parsePuzzleShareToken(sharedPuzzleToken);
    if(puzzle?.mode==="daily")return `daily:${puzzle.date}`;
    if(puzzle?.mode==="practice"){
      return `classic:${puzzle.length}:${puzzle.answerVersion}:${puzzle.seed}`;
    }
  }

  if(gameMode==="classic" || (gameMode==="shared" && isClassicVariant())){
    return `classicmode:${COLS}:${gameAnswerVersion}:${gameSeed}`;
  }

  if(gameMode==="practice"){
    return `classic:${COLS}:${gameAnswerVersion}:${gameSeed}`;
  }

  return "";
}

function recordHistoryEntry(won,tries){
  const history=loadHistory();
  const puzzleKey=currentHistoryPuzzleKey();

  const entry={
    id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    word:secretWord,
    length:COLS,
    mode:gameMode,
    won:Boolean(won),
    tries:won?tries:null,
    date:new Date().toISOString(),
    gameSeed,
    gameAnswerVersion,
    sharedPuzzleToken,
    gameVariant,
    attemptLimit:currentAttemptLimit(),
    durationSeconds:currentGameElapsedSeconds(),
    puzzleKey
  };

  if(puzzleKey){
    const index=history.findIndex(item=>item.puzzleKey===puzzleKey);
    if(index>=0){
      history[index]=mergeHistoryEntries(history[index],entry);
      saveHistory(history);
      return;
    }
  }

  history.unshift(entry);
  saveHistory(history);
}

async function copyText(text,successMessage="Kopyalandı."){
  try{
    if(!navigator.clipboard)throw new Error("Clipboard API yok");
    await navigator.clipboard.writeText(text);
    flashMessage(successMessage);
  }catch(e){
    flashMessage("Panoya kopyalama bu tarayıcıda desteklenmiyor.");
  }
}

function launchConfetti(){
  if(!loadSettings().animations)return;

  document.querySelectorAll(".confetti-layer").forEach(layer=>layer.remove());

  const layer=document.createElement("div");
  layer.className="confetti-layer";
  layer.setAttribute("aria-hidden","true");

  const rootStyle=getComputedStyle(document.documentElement);
  const colors=[
    rootStyle.getPropertyValue("--green").trim() || "#59ad55",
    rootStyle.getPropertyValue("--yellow").trim() || "#cdb65a",
    rootStyle.getPropertyValue("--red").trim() || "#df4c50",
    "#ece9e7",
    "#ffffff"
  ];

  for(let i=0;i<96;i++){
    const piece=document.createElement("i");
    piece.className=`confetti-piece confetti-shape-${i%3}`;
    piece.style.left=`${Math.random()*100}%`;
    piece.style.setProperty("--drift-a",`${(Math.random()-.5)*120}px`);
    piece.style.setProperty("--drift-b",`${(Math.random()-.5)*220}px`);
    piece.style.setProperty("--spin",`${720+Math.random()*1080}deg`);
    piece.style.setProperty("--duration",`${2.3+Math.random()*1.9}s`);
    piece.style.setProperty("--delay",`${Math.random()*.55}s`);
    piece.style.setProperty("--w",`${5+Math.random()*7}px`);
    piece.style.setProperty("--h",`${8+Math.random()*10}px`);
    piece.style.background=colors[Math.floor(Math.random()*colors.length)];
    layer.appendChild(piece);
  }

  document.body.appendChild(layer);
  setTimeout(()=>layer.remove(),5000);
}

function resultWordActionsHTML(){
  const favorite=isFavorite(secretWord);

  return `
    <div class="result-word-card">
      <span class="result-word-label">Kelime</span>
      <strong>${escapeHTML(secretWord)}</strong>

      <div class="result-word-actions">
        <button class="compact-action" id="meaningWordBtn">📖 Anlamı</button>

        <button class="compact-action" id="favoriteWordBtn">
          ${favorite?"★ Favoriden Çıkar":"☆ Favorile"}
        </button>

        <a class="compact-action danger-soft"
           href="${reportWordUrl(secretWord)}">⚑ Kelimeyi Bildir</a>
      </div>
    </div>
  `;
}

function bindResultWordActions({won,tries}){
  const meaningBtn=$("#meaningWordBtn");
  if(meaningBtn){
    meaningBtn.onclick=()=>showWordMeaning(secretWord,{
      backAction:()=>showResultModal(won,tries)
    });
  }

  const favoriteBtn=$("#favoriteWordBtn");
  if(favoriteBtn){
    favoriteBtn.onclick=()=>{
      const active=toggleFavorite(secretWord);
      favoriteBtn.textContent=active?"★ Favoriden Çıkar":"☆ Favorile";
    };
  }
}

function showHistoryModal(){
  const history=loadHistory();
  const favorites=loadFavorites();

  const favoriteHtml=favorites.size
    ? `<div class="favorite-tags">
        ${[...favorites].sort().map(word=>`
          <button class="favorite-tag" data-meaning-word="${escapeHTML(word)}">★ ${escapeHTML(word)}</button>
        `).join("")}
       </div>`
    : `<p class="empty-state">Henüz favori kelime yok.</p>`;

  const historyHtml=history.length
    ? history.map(item=>{
        const unresolvedDaily=item.mode==="daily" && !item.won;
        const visibleWord=unresolvedDaily ? "ÇÖZÜLEMEDİ" : item.word;

        return `
          <article class="history-item">
            ${unresolvedDaily
              ? `<span class="history-favorite history-favorite-muted" aria-hidden="true">☆</span>`
              : `<button class="history-favorite"
                        data-favorite-word="${escapeHTML(item.word)}"
                        aria-label="${escapeHTML(item.word)} favori durumu">
                  ${favorites.has(item.word)?"★":"☆"}
                </button>`
            }

            <div>
              <b>${escapeHTML(visibleWord)}</b>
              <span>
                ${item.mode==="daily"
                  ? "Günlük"
                  : item.mode==="shared"
                    ? "Paylaşılan"
                    : item.mode==="classic" || item.gameVariant==="classic"
                      ? "Klasik"
                      : `Kelimelik · ${item.length} Harf`}
                · ${item.won
                  ? `${item.tries}/${Number(item.attemptLimit)||8}`
                  : `X/${Number(item.attemptLimit)||8}`}
              </span>
            </div>

            ${unresolvedDaily
              ? `<span class="history-meaning history-meaning-muted">—</span>`
              : `<button class="history-meaning"
                        data-meaning-word="${escapeHTML(item.word)}">Anlamı</button>`
            }
          </article>
        `;
      }).join("")
    : `<p class="empty-state">Henüz tamamlanmış oyun yok.</p>`;

  showModal(`
    <h2>Kelime Geçmişi</h2>
    <h3>Favoriler</h3>
    ${favoriteHtml}

    <h3>Son Oyunlar</h3>
    <div class="history-list">${historyHtml}</div>
  `,{closeAction:showSettingsModal});

  document.querySelectorAll("[data-favorite-word]").forEach(btn=>{
    btn.onclick=()=>{
      toggleFavorite(btn.dataset.favoriteWord);
      showHistoryModal();
    };
  });

  document.querySelectorAll("[data-meaning-word]").forEach(btn=>{
    btn.onclick=()=>showWordMeaning(btn.dataset.meaningWord,{
      backAction:showHistoryModal
    });
  });

}

function showSettingsModal(){
  const settings=loadSettings();

  showModal(`
    <h2>Ayarlar</h2>

    <div class="settings-row settings-row-first">
      <div>
        <b>Animasyonlar</b>
      </div>

      <label class="switch">
        <input id="animationSetting" type="checkbox" ${settings.animations?"checked":""}>
        <span></span>
      </label>
    </div>

    <div class="settings-row">
      <div>
        <b>Renk Körü Modu</b>
      </div>

      <label class="switch">
        <input id="colorBlindSetting" type="checkbox" ${settings.colorBlind?"checked":""}>
        <span></span>
      </label>
    </div>

    <div class="settings-links">
      <button class="menu-action" id="historySettingsBtn">
        <b>Kelime Geçmişi & Favoriler</b>
        <small>Çözdüğün ve kaydettiğin kelimeleri gör.</small>
      </button>

      <a class="menu-action link-action"
         href="mailto:bilgehanakbas0@gmail.com?subject=Kelimelik%20Feedback">
        <b>✉ Feedback Gönder</b>
        <small>Öneri veya hata bildir.</small>
      </a>
    </div>
  `);

  $("#animationSetting").onchange=e=>{
    const next=loadSettings();
    next.animations=e.target.checked;
    saveSettings(next);
  };

  $("#colorBlindSetting").onchange=e=>{
    const next=loadSettings();
    next.colorBlind=e.target.checked;
    saveSettings(next);
  };

  $("#historySettingsBtn").onclick=showHistoryModal;
}

function getDailyPuzzleInfo(dateKey=todayKey()){
  return CORE.chooseDailyWord(DAILY_SERIES,dateKey,DAILY_EPOCH);
}

function dailyPuzzleNumber(dateKey=todayKey()){
  return CORE.dailyPuzzleNumber(dateKey,DAILY_EPOCH);
}

function chooseDailySecret(){
  return getDailyPuzzleInfo().word;
}

function updateResponsiveBoardSize(){
  const viewport=Math.max(260,Number(window.innerWidth)||1024);
  const totalColumns=COLS+(isClassicVariant()?0:3);

  if(viewport>760){
    const height=Math.max(520,Number(window.innerHeight)||900);

    /* Normal masaüstünde daha dolu görünür.
       Sadece ekran gerçekten kısaysa otomatik küçülür. */
    const size=height<690 ? 38 : height<780 ? 41 : height<880 ? 43 : 45;
    const gap=height<690 ? 4 : 5;

    board.style.setProperty("--s",`${size}px`);
    board.style.setProperty("--board-gap",`${gap}px`);
    return;
  }

  const gap=viewport<=420 ? 4 : 5;
  const horizontalReserve=viewport<=420 ? 16 : 22;
  const available=Math.max(230,viewport-horizontalReserve);
  const size=Math.max(
    24,
    Math.min(45,Math.floor((available-(gap*(totalColumns-1)))/totalColumns))
  );

  board.style.setProperty("--s",`${size}px`);
  board.style.setProperty("--board-gap",`${gap}px`);
}

function buildBoard(){
  board.innerHTML="";
  const attempts=currentAttemptLimit();
  const counterColumns=isClassicVariant() ? 0 : 3;

  board.classList.toggle("classic-direct-board",isClassicVariant());
  board.style.gridTemplateColumns=counterColumns
    ? `repeat(${COLS},var(--s)) repeat(3,var(--s))`
    : `repeat(${COLS},var(--s))`;

  updateResponsiveBoardSize();

  for(let r=0;r<attempts;r++){
    for(let c=0;c<COLS;c++){
      const b=document.createElement("button");
      b.className="tile";
      b.dataset.r=r;b.dataset.c=c;
      b.setAttribute?.("aria-label",`Satır ${r+1}, sütun ${c+1}, boş`);
      b.onclick=()=>{
        if(!isClassicVariant())cycleTile(r,c);
        b.blur();
      };
      board.appendChild(b);
    }

    if(!isClassicVariant()){
      ["green","yellow","red"].forEach(kind=>{
        const x=document.createElement("div");
        x.className=`counter counter-${kind}`;
        x.dataset.r=r;x.dataset.kind=kind;
        const label={green:"Yeşil",yellow:"Sarı",red:"Kırmızı"}[kind];
        x.setAttribute?.("role","status");
        x.setAttribute?.("aria-label",`Satır ${r+1}, ${label} sayaç`);
        board.appendChild(x);
      });
    }
  }
}

/* Harf kutularını kullanıcı düşünmek/işaretlemek için boyayabilir.
   Bu renkler sağdaki sayaçları ASLA değiştirmez. */
function cycleTile(r,c){
  if(isClassicVariant())return;
  const cell=guesses[r][c];
  if(!cell.letter)return;
  cell.state=STATE_ORDER[(STATE_ORDER.indexOf(cell.state)+1)%STATE_ORDER.length];
  render();
}

function animateTileEntry(row,col){
  if(!loadSettings().animations)return;

  const tile=document.querySelector(`.tile[data-r="${row}"][data-c="${col}"]`);
  if(!tile)return;

  tile.classList.remove("tile-pop");
  void tile.offsetWidth;
  tile.classList.add("tile-pop");

  setTimeout(()=>tile.classList.remove("tile-pop"),260);
}

function addLetter(letter){
  if(gameFinished)return;
  if(submitted[activeRow])return;
  if(activeCol>=COLS)return;

  clearInvalidRow(activeRow);
  const row=activeRow;
  const col=activeCol;
  guesses[row][col]={letter,state:"none"};
  activeCol++;
  render();
  animateTileEntry(row,col);
}

function backspace(){
  if(gameFinished)return;
  if(submitted[activeRow])return;
  if(activeCol<=0)return;

  clearInvalidRow(activeRow);
  activeCol--;
  guesses[activeRow][activeCol]={letter:"",state:"none"};
  render();
}

function clearColors(){
  if(isClassicVariant())return;
  guesses.forEach((row,r)=>{
    if(submitted[r])row.forEach(cell=>cell.state="none");
  });
  render();
}

function clearInvalidRow(row){
  document.querySelectorAll(`.tile[data-r="${row}"]`).forEach(tile=>{
    tile.classList.remove("invalid-word");
  });
}

function announceGameStatus(message){
  const status=$("#gameStatus");
  if(!status)return;
  status.textContent="";
  requestAnimationFrame(()=>{
    status.textContent=String(message||"");
  });
}

function markInvalidRow(row){
  clearInvalidRow(row);

  document.querySelectorAll(`.tile[data-r="${row}"]`).forEach(tile=>{
    tile.classList.add("invalid-word");
  });

  announceGameStatus("Bu kelime geçerli değil. Tahmin hakkın kullanılmadı.");

  setTimeout(()=>{
    clearInvalidRow(row);
  },650);
}


/* Gerçek harf geri bildirimi sayımı:
   1) Önce doğru yerde olanlar (yeşil)
   2) Sonra kalan harf havuzundan yanlış yerde olanlar (sarı)
   3) Kalanlar kırmızı
*/
function calculateFeedback(guess,answer){
  return CORE.calculateFeedback(guess,answer);
}

function animateSubmittedRow(row){
  if(!loadSettings().animations)return;

  const tiles=[...document.querySelectorAll(`.tile[data-r="${row}"]`)];
  tiles.forEach((tile,index)=>{
    tile.style.setProperty("--reveal-delay",`${index*65}ms`);
    tile.classList.remove("tile-submit");
    void tile.offsetWidth;
    tile.classList.add("tile-submit");

    setTimeout(()=>{
      tile.classList.remove("tile-submit");
      tile.style.removeProperty("--reveal-delay");
    },620+index*65);
  });

  const fb=feedbacks[row];
  if(!fb || isClassicVariant())return;

  const kinds=["green","yellow","red"];
  kinds.forEach((kind,index)=>{
    const box=document.querySelector(`.counter[data-r="${row}"][data-kind="${kind}"]`);
    if(!box)return;

    const finalValue=fb[kind];
    const delay=COLS*65+index*95;

    box.textContent="0";
    box.classList.remove("counter-reveal");

    setTimeout(()=>{
      box.textContent=String(finalValue);
      box.classList.add("counter-reveal");
    },delay);

    setTimeout(()=>{
      box.classList.remove("counter-reveal");
    },delay+420);
  });
}

function submittedRowAnimationDuration(){
  if(!loadSettings().animations)return 0;

  const tileSequence=620+Math.max(0,COLS-1)*65;
  if(isClassicVariant())return tileSequence+220;

  const counterSequence=COLS*65+2*95+420;

  /* Son kutu ve sayaç tamamen yerine oturduktan sonra
     sonuç modalına çok kısa bir nefes payı bırak. */
  return Math.max(tileSequence,counterSequence)+320;
}

function resultRevealDelay(){
  return submittedRowAnimationDuration();
}

function clearPendingResultReveal(){
  if(pendingResultTimer!==null){
    clearTimeout(pendingResultTimer);
    pendingResultTimer=null;
  }
}

function scheduleResultReveal(won,tries,runId=gameRunId){
  clearPendingResultReveal();
  pendingResultTimer=setTimeout(()=>{
    pendingResultTimer=null;
    if(runId!==gameRunId)return;

    if(won)launchConfetti();
    showResultModal(won,won?tries:null);
  },resultRevealDelay());
}

function submitGuess(){
  if(gameFinished)return;
  if(submitted[activeRow])return;
  const guess=guesses[activeRow].map(x=>x.letter).join("");
  if(guess.length!==COLS){
    markInvalidRow(activeRow);
    announceGameStatus(`Tahmin ${COLS} harf olmalı. Tahmin hakkın kullanılmadı.`);
    return;
  }

  if(!VALID_WORDS.has(guess)){
    markInvalidRow(activeRow);
    return;
  }

  clearInvalidRow(activeRow);
  const submittedRow=activeRow;
  feedbacks[submittedRow]=calculateFeedback(guess,secretWord);
  submitted[submittedRow]=true;

  if(isClassicVariant()){
    feedbacks[submittedRow].pattern.forEach((state,index)=>{
      guesses[submittedRow][index].state=state;
    });
  }

  if(guess===secretWord){
    const tries=submittedRow+1;
    const runId=gameRunId;
    recordGameResult(true,tries);
    render();
    animateSubmittedRow(submittedRow);
    scheduleResultReveal(true,tries,runId);
    return;
  }

  if(submittedRow===currentAttemptLimit()-1){
    const runId=gameRunId;
    recordGameResult(false,null);
    render();
    animateSubmittedRow(submittedRow);
    scheduleResultReveal(false,null,runId);
    return;
  }

  activeRow++;
  activeCol=0;
  render();
  animateSubmittedRow(submittedRow);
}


function renderKeyboardUsage(){
  const used=new Set();
  const directStates=new Map();
  const rank={red:1,yellow:2,green:3};

  guesses.forEach((row,r)=>{
    if(!submitted[r])return;

    row.forEach((cell,index)=>{
      if(!cell.letter)return;
      used.add(cell.letter);

      if(isClassicVariant()){
        const state=feedbacks[r]?.pattern?.[index] || "red";
        const previous=directStates.get(cell.letter);
        if(!previous || rank[state]>rank[previous]){
          directStates.set(cell.letter,state);
        }
      }
    });
  });

  document.querySelectorAll(".key[data-letter]").forEach(key=>{
    const letter=key.dataset.letter;
    key.classList.remove("feedback-red","feedback-yellow","feedback-green");

    if(isClassicVariant()){
      key.classList.remove("used");
      const state=directStates.get(letter);
      if(state)key.classList.add(`feedback-${state}`);
    }else{
      key.classList.toggle("used",used.has(letter));
    }
  });
}

function render(){
  document.querySelectorAll(".tile").forEach(t=>{
    const r=+t.dataset.r,c=+t.dataset.c;
    const cell=guesses[r][c];
    const nextClass="tile"+(cell.state==="none"?"":` state-${cell.state}`);

    /* Hızlı harf girişinde yalnızca gerçekten değişen kutuyu güncelle.
       Böylece önceki kutulardaki tile-pop / tile-submit animasyonları
       yeni bir tuş vuruşu geldiğinde className sıfırlanarak yarıda kesilmez. */
    if(t.textContent!==cell.letter)t.textContent=cell.letter;

    if(t.dataset.baseClass!==nextClass){
      t.dataset.baseClass=nextClass;

      /* Devam eden animasyon ve geçersiz-kelime durumunu koru;
         sadece kutunun temel renk/state class'ını değiştir. */
      const transient=["tile-pop","tile-submit","invalid-word"]
        .filter(cls=>t.classList.contains(cls));

      t.className=[nextClass,...transient].join(" ");
    }

    const stateLabel={none:"işaretsiz",red:"kırmızı",yellow:"sarı",green:"yeşil"}[cell.state] || "işaretsiz";
    t.setAttribute?.(
      "aria-label",
      `Satır ${r+1}, sütun ${c+1}, ${cell.letter||"boş"}, ${stateLabel}`
    );
  });

  for(let r=0;r<currentAttemptLimit();r++){
    const fb=feedbacks[r];
    for(const kind of ["green","yellow","red"]){
      const box=document.querySelector(`.counter[data-r="${r}"][data-kind="${kind}"]`);
      if(!box)continue;
      box.textContent=fb ? fb[kind] : "";
      const label={green:"Yeşil",yellow:"Sarı",red:"Kırmızı"}[kind];
      box.setAttribute?.(
        "aria-label",
        `Satır ${r+1}, ${label} sayaç${fb ? `: ${fb[kind]}` : ""}`
      );
    }
  }

  renderKeyboardUsage();
  renderHintState();
  updateGameModeStrip();
  saveGame();
}

function buildKeyboard(){
  const rows=[
    ["Q","W","E","R","T","Y","U","I","O","P","Ğ","Ü"],
    ["A","S","D","F","G","H","J","K","L","Ş","İ"],
    ["Z","X","C","V","B","N","M","Ö","Ç"]
  ];

  keyboard.innerHTML="";

  rows.forEach((chars,i)=>{
    const row=document.createElement("div");
    row.className="key-row";

    chars.forEach(ch=>{
      const b=document.createElement("button");
      b.className="key";
      b.textContent=ch;
      b.dataset.letter=ch;
      b.onclick=()=>{
        addLetter(ch);
        b.blur();
      };
      row.appendChild(b);
    });

    if(i===2){
      const d=document.createElement("button");
      d.className="key action";
      d.textContent="⌫";
      d.setAttribute?.("aria-label","Son harfi sil");
      d.onclick=()=>{
        backspace();
        d.blur();
      };
      row.appendChild(d);
    }

    keyboard.appendChild(row);
  });

  const last=document.createElement("div");
  last.className="key-row key-action-row";
  last.innerHTML=
    '<button class="key action tooltip-btn" data-a="erase" data-tooltip="Tüm işaretlemeleri kaldır" aria-label="Tüm işaretlemeleri kaldır">◆</button>'+
    '<button class="key action tooltip-btn" id="hintKey" data-a="hint" data-tooltip="İpucu kullan" aria-label="İpucu kullan">💡</button>'+
    '<button class="key action tooltip-btn" data-a="ok" data-tooltip="Tahmini gönder" aria-label="Tahmini gönder">✓</button>';

  last.onclick=e=>{
    const a=e.target.dataset.a;
    if(a==="erase")clearColors();
    if(a==="hint")useHint();
    if(a==="ok")submitGuess();
  };

  keyboard.appendChild(last);
}

function sameCountFeedback(a,b){
  return CORE.sameCountFeedback(a,b);
}

/* Kullanıcıya gösterilen sayaçlarla uyumlu olabilecek gizli kelimeleri bulur. */
function possibleSecrets(){
  const completed=[];

  for(let r=0;r<ROWS;r++){
    if(!submitted[r] || !feedbacks[r])continue;

    completed.push({
      guess:guesses[r].map(x=>x.letter).join(""),
      feedback:feedbacks[r]
    });
  }

  return CORE.possibleSecrets(ANSWER_WORDS,completed);
}

function scoreHintWords(candidates){
  return CORE.scoreHintWords(candidates,"tr");
}

function bestSubmittedGreenCount(){
  let best=0;
  for(let r=0;r<currentAttemptLimit();r++){
    if(!submitted[r] || !feedbacks[r])continue;
    best=Math.max(best,Number(feedbacks[r].green)||0);
  }
  return best;
}

function bestSubmittedCorrectCount(){
  let best=0;
  for(let r=0;r<currentAttemptLimit();r++){
    if(!submitted[r] || !feedbacks[r])continue;
    const green=Number(feedbacks[r].green)||0;
    const yellow=Number(feedbacks[r].yellow)||0;
    best=Math.max(best,green+yellow);
  }
  return best;
}

function hintCandidatesWithGreenFloor(candidates){
  return CORE.filterHintWordsByGreenFloor(
    candidates,
    secretWord,
    bestSubmittedGreenCount()
  );
}

function findHintRow(){
  for(let r=activeRow;r<currentAttemptLimit();r++){
    if(submitted[r])continue;
    const empty=guesses[r].every(cell=>!cell.letter);
    if(empty)return r;
  }
  for(let r=0;r<activeRow;r++){
    if(submitted[r])continue;
    const empty=guesses[r].every(cell=>!cell.letter);
    if(empty)return r;
  }
  return -1;
}

function useHint(){
  if(isClassicVariant()){
    announceGameStatus("Klasik Modda ipucu kullanılmaz.");
    return;
  }

  if(hintUsed){
    flashMessage("Bu oyunda ipucunu zaten kullandın.");
    return;
  }

  if(!submitted.some(Boolean)){
    flashMessage("İpucu kullanabilmek için önce en az bir tahmin göndermelisin.");
    return;
  }

  const row=findHintRow();
  if(row===-1){
    flashMessage("İpucunun doldurabileceği boş bir tahmin satırı yok.");
    return;
  }

  const candidates=possibleSecrets();
  const greenSafeCandidates=hintCandidatesWithGreenFloor(candidates);
  const usedWords=new Set(
    guesses
      .filter((row,index)=>submitted[index] && Array.isArray(row))
      .map(row=>row.map(cell=>cell.letter).join(""))
      .filter(Boolean)
  );

  /*
   * İpucu geçmiş tahminlerin yeşil/sarı/kırmızı sayaçlarıyla mümkün olduğunca
   * tutarlı kalır ve mevcut en iyi yeşil sayısını korumaya çalışır. Ancak ipucu
   * hiçbir koşulda gizli cevabı doğrudan yazıp oyunu otomatik kazandırmaz.
   */
  const bestCorrectFloor=bestSubmittedCorrectCount();
  const baseHintPool=(greenSafeCandidates.length ? greenSafeCandidates : candidates)
    .filter(word=>word!==secretWord && !usedWords.has(word));
  const correctSafe=baseHintPool.filter(word=>{
    const fb=calculateFeedback(word,secretWord);
    return (Number(fb.green)||0)+(Number(fb.yellow)||0) >= bestCorrectFloor;
  });
  const primary=(correctSafe.length ? correctSafe : baseHintPool);
  let ranked=scoreHintWords(primary);

  if(!ranked.length){
    const floor=bestSubmittedGreenCount();
    const safeFallback=ANSWER_WORDS.filter(word=>
      word!==secretWord &&
      !usedWords.has(word) &&
      calculateFeedback(word,secretWord).green>=floor
    );
    ranked=scoreHintWords(safeFallback);
  }

  if(!ranked.length){
    const nonSecret=ANSWER_WORDS.filter(word=>word!==secretWord && !usedWords.has(word));
    const infoScores=new Map(scoreHintWords(nonSecret).map(item=>[item.word,item.score]));
    ranked=nonSecret.map(word=>{
      const fb=calculateFeedback(word,secretWord);
      return {
        word,
        green:Number(fb.green)||0,
        correct:(Number(fb.green)||0)+(Number(fb.yellow)||0),
        score:Number(infoScores.get(word))||0
      };
    }).sort((a,b)=>
      b.green-a.green ||
      b.correct-a.correct ||
      b.score-a.score ||
      a.word.localeCompare(b.word,"tr")
    );
  }

  const hintWord=ranked[0]?.word || "";
  if(!hintWord){
    flashMessage("Bu konumda cevabı vermeden üretilebilecek uygun bir ipucu kalmadı.");
    return;
  }

  guesses[row]=[...hintWord].map(letter=>({letter,state:"none"}));
  activeRow=row;
  activeCol=COLS;
  hintUsed=true;

  /* İpucu kelimesi doğrudan bir tahmin olarak değerlendirilir.
     Böylece sağdaki yeşil/sarı/kırmızı sayaçlar anında gelir. */
  const guess=hintWord;
  feedbacks[row]=calculateFeedback(guess,secretWord);
  submitted[row]=true;

  if(row<currentAttemptLimit()-1){
    activeRow=row+1;
    activeCol=0;
    render();
    flashMessage(`İpucu kullanıldı. ${hintWord} kelimesi eklendi.`);
  }else{
    render();
    showLose();
  }
}

function renderHintState(){
  const key=$("#hintKey");
  const erase=keyboard.querySelector?.('[data-a="erase"]') || null;
  const direct=isClassicVariant();

  if(erase){
    erase.disabled=direct;
    erase.title=direct ? "Klasik Modda manuel işaretleme yok" : "Tüm işaretlemeleri kaldır";
    erase.dataset.tooltip=erase.title;
  }

  if(!key)return;

  if(direct){
    key.disabled=true;
    key.classList.add("hint-locked");
    key.classList.remove("hint-used");
    key.title="Klasik Modda ipucu yok";
    key.dataset.tooltip=key.title;
    return;
  }

  const available=submitted.some(Boolean) && !hintUsed;
  key.disabled=!available;
  key.classList.toggle("hint-locked",!submitted.some(Boolean) && !hintUsed);
  key.classList.toggle("hint-used",hintUsed);
  key.title=hintUsed
    ? "Bu oyunda ipucu kullanıldı"
    : available
      ? "Bir kelime öner"
      : "İpucu için önce en az bir tahmin gönder";
  key.dataset.tooltip=key.title;
}

function newGame(
  mode=gameMode,
  length=COLS,
  seed=null,
  answerVersion=CURRENT_ANSWER_VERSION
){
  clearPendingResultReveal();
  gameRunId++;
  if(mode==="daily" && dailyPlayedToday()){
    showDailyAlreadyPlayed();
    return false;
  }

  if(mode==="daily")length=5;

  if(mode==="daily" && restoreDailyProgress()){
    buildBoard();
    render();
    return true;
  }

  if(mode==="daily"){
    setWordLength(length,CURRENT_ANSWER_VERSION);
  }else{
    if(!ANSWER_POOL_VERSIONS?.[answerVersion]){
      flashMessage("Bu oyun kodunun kelime sürümü artık desteklenmiyor.");
      return false;
    }
    setWordLength(length,answerVersion);
  }

  gameMode=mode;
  gameVariant=mode==="classic" ? "classic" : "kelimelik";
  sharedPuzzleToken="";
  guesses=emptyRows();
  feedbacks=Array.from({length:ROWS},()=>null);
  submitted=Array(ROWS).fill(false);
  activeRow=0;
  activeCol=0;
  hintUsed=false;
  gameFinished=false;
  gameElapsedBeforeStart=0;
  stopGameTimer();

  if(gameMode==="daily"){
    clearDailyProgress();
    const dailyInfo=getDailyPuzzleInfo();
    gameSeed=todayKey();
    gameDailyVersion=dailyInfo.version;
    secretWord=dailyInfo.word;
  }else{
    gameDailyVersion="";
    gameAnswerVersion=answerVersion;
    if(seed){
      gameSeed=seed;
      secretWord=chooseSeededSecret(gameSeed,gameAnswerVersion);
    }else{
      const fresh=chooseFreshRandomSecret(gameAnswerVersion);
      gameSeed=fresh.seed;
      secretWord=fresh.word;
      if(gameMode==="practice" || gameMode==="classic"){
        rememberRecentAnswer(secretWord,COLS);
      }
    }
  }

  storageRemove("kelimelik-game-v18");
  buildBoard();
  render();
  startGameTimer();
  return true;
}

function saveGame(){
  const payload={
    guesses,feedbacks,submitted,activeRow,activeCol,secretWord,
    hintUsed,gameMode,gameVariant,gameFinished,COLS,gameSeed,
    gameAnswerVersion,gameDailyVersion,sharedPuzzleToken,
    gameElapsedSeconds:currentGameElapsedSeconds()
  };

  storageSet("kelimelik-game-v18",JSON.stringify(payload));

  if(gameMode==="daily" && !gameFinished){
    storageSet(
      DAILY_PROGRESS_KEY,
      JSON.stringify({...payload,date:todayKey()})
    );
  }

  if(gameMode==="shared" && sharedPuzzleToken){
    saveSharedPlay(sharedPuzzleToken,{
      ...payload,
      completed:Boolean(gameFinished),
      won:gameFinished
        ? Boolean(getSharedPlay(sharedPuzzleToken)?.won)
        : false
    });
  }
}

function restoreGame(){
  try{
    const s=JSON.parse(localStorage.getItem("kelimelik-game-v18")||"null");

    if(s?.secretWord && Array.isArray(s.guesses) && s.guesses.length===ROWS){
      const savedCols=Number(s.COLS)||5;
      if(![4,5,6].includes(savedCols))throw new Error("Geçersiz kayıt uzunluğu");

      // A2 öncesi kayıtların version alanı yoktu; bu kayıtlar A1 olarak üretilmişti.
      const savedAnswerVersion=typeof s.gameAnswerVersion==="string"
        ? s.gameAnswerVersion
        : "A1";

      setWordLength(savedCols,savedAnswerVersion);
      if(!VALID_WORDS.has(s.secretWord))throw new Error("Eski kayıt mevcut sözlükle uyumsuz");

      guesses=s.guesses;
      feedbacks=Array.isArray(s.feedbacks)
        ? s.feedbacks
        : Array.from({length:ROWS},()=>null);
      submitted=Array.isArray(s.submitted)
        ? s.submitted
        : Array(ROWS).fill(false);

      secretWord=s.secretWord;
      hintUsed=Boolean(s.hintUsed);
      gameMode=["daily","practice","classic","shared"].includes(s.gameMode)
        ? s.gameMode
        : "practice";
      gameVariant=s.gameVariant==="classic" || gameMode==="classic"
        ? "classic"
        : "kelimelik";
      activeRow=Math.max(0,Math.min(currentAttemptLimit()-1,Number(s.activeRow)||0));
      activeCol=Math.max(0,Math.min(COLS,Number(s.activeCol)||0));
      gameFinished=Boolean(s.gameFinished);
      gameSeed=typeof s.gameSeed==="string"
        ? s.gameSeed
        : (gameMode==="daily"?todayKey():"");
      gameAnswerVersion=savedAnswerVersion;
      gameDailyVersion=typeof s.gameDailyVersion==="string" ? s.gameDailyVersion : "";
      sharedPuzzleToken=typeof s.sharedPuzzleToken==="string" ? s.sharedPuzzleToken : "";
      gameElapsedBeforeStart=Math.max(0,Number(s.gameElapsedSeconds)||0);
      stopGameTimer();
      return;
    }
  }catch(e){
    storageRemove("kelimelik-game-v18");
  }

  setWordLength(5,CURRENT_ANSWER_VERSION);
  guesses=emptyRows();
  feedbacks=Array.from({length:ROWS},()=>null);
  submitted=Array(ROWS).fill(false);
  activeRow=0;
  activeCol=0;
  hintUsed=false;
  gameMode="practice";
  gameVariant="kelimelik";
  gameFinished=false;
  gameElapsedBeforeStart=0;
  stopGameTimer();
  gameAnswerVersion=CURRENT_ANSWER_VERSION;
  gameDailyVersion="";
  sharedPuzzleToken="";
  const fresh=chooseFreshRandomSecret(gameAnswerVersion);
  gameSeed=fresh.seed;
  secretWord=fresh.word;
  rememberRecentAnswer(secretWord,COLS);
}

let modalCloseAction=null;
let modalReturnFocus=null;

function clearLiveModalClosePin(){
  const modal=modalBody?.parentNode;
  const regularClose=$("#modalClose");
  const liveClose=$("#liveModalClose");

  modal?.classList.remove("live-close-pinned");
  regularClose?.removeAttribute("hidden");
  document.documentElement.classList.remove("mobile-live-game-open");
  document.body?.classList.remove("mobile-live-game-open");

  if(liveClose){
    liveClose.hidden=true;
    liveClose.classList.remove("show");
  }
}

function pinLiveModalCloseButton(){
  const modal=modalBody?.parentNode;
  const regularClose=$("#modalClose");
  const liveClose=$("#liveModalClose");
  if(!modal || !regularClose || !liveClose)return false;

  /*
   * Telefonlardaki gerçek online/bot maçında X artık backdrop/modal ağacının
   * DIŞINDADIR. Konumu oyun/modal kaydırmasına göre hesaplanmaz;
   * CSS position:fixed ile doğrudan tarayıcı görünüm alanına bağlanır.
   */
  const isActualOnlineGame=Boolean($("#liveMatchRoot"));
  const shouldPin=window.innerWidth<=760 &&
    modal.classList.contains("live-match-modal") &&
    isActualOnlineGame;

  if(!shouldPin){
    clearLiveModalClosePin();
    return false;
  }

  regularClose.hidden=true;
  liveClose.hidden=false;
  liveClose.classList.add("show");
  modal.classList.add("live-close-pinned");
  document.documentElement.classList.add("mobile-live-game-open");
  document.body?.classList.add("mobile-live-game-open");
  return true;
}

function alignModalCloseButton(){
  const modal=modalBody?.parentNode;
  const close=$("#modalClose");
  if(!modal || !close)return;

  if(typeof modal.style?.removeProperty==="function")modal.style.removeProperty("--modal-close-top");
  else if(modal.style)delete modal.style["--modal-close-top"];

  /*
   * Mobil online/bot penceresinde X, kaydırılan içerikten tamamen bağımsızdır.
   * Modalın viewport üzerindeki sağ-üst köşesine sabitlenir; DOM güncellemeleri
   * veya içerik scroll'u X koordinatını değiştiremez.
   */
  if(pinLiveModalCloseButton())return;

  /*
   * Standart modallarda yalnız gerçek modal başlığını referans al. Sonuç kartı,
   * hızlı eşleşme kartı vb. içerideki h2'ler X'i aşağı sürüklememeli.
   */
  const directHeading=Array.from(modalBody.children||[])
    .find(node=>String(node?.tagName||"").toUpperCase()==="H2") || null;
  const liveHeading=modalBody.querySelector?.(".live-match-head h2") || null;
  const heading=directHeading || liveHeading;
  if(!heading)return;

  const modalRect=modal.getBoundingClientRect?.();
  const headingRect=heading.getBoundingClientRect?.();
  const closeRect=close.getBoundingClientRect?.();
  if(!modalRect || !headingRect)return;

  const closeHeight=Number(closeRect?.height)||44;
  const headingHeight=Number(headingRect?.height)||closeHeight;
  const relativeTop=(Number(headingRect.top)||0)-(Number(modalRect.top)||0)
    + ((headingHeight-closeHeight)/2);
  const minTop=window.innerWidth<=760?8:10;
  modal.style.setProperty("--modal-close-top",`${Math.max(minTop,Math.round(relativeTop))}px`);
}

function showModal(html,{closeAction=null,bodyClass=""}={}){
  if(modalBackdrop.hidden){
    modalReturnFocus=document.activeElement?.focus
      ? document.activeElement
      : null;
  }

  modalCloseAction=typeof closeAction==="function" ? closeAction : null;
  modalBody.className=bodyClass || "";
  modalBody.closest?.(".modal")?.classList.toggle("live-match-modal",bodyClass==="live-match-modal-body");
  modalBody.innerHTML=html;
  modalBackdrop.hidden=false;
  requestAnimationFrame(()=>{
    alignModalCloseButton();
    const liveClose=$("#liveModalClose");
    if(liveClose && !liveClose.hidden){
      liveClose.focus();
    }else{
      $("#modalClose")?.focus();
    }
  });
}

function closeModal(){
  modalCloseAction=null;
  modalBackdrop.hidden=true;
  modalBody.className="";
  modalBody.closest?.(".modal")?.classList.remove("live-match-modal");
  clearLiveModalClosePin();

  const target=modalReturnFocus;
  modalReturnFocus=null;
  if(target?.isConnected)target.focus();
}

function closeOrBackModal(){
  const action=modalCloseAction;
  modalCloseAction=null;
  if(action){
    action();
    return;
  }
  closeModal();
}

if(typeof MutationObserver!=="undefined"){
  const modalAlignmentObserver=new MutationObserver(()=>{
    if(modalBackdrop.hidden)return;
    requestAnimationFrame(alignModalCloseButton);
  });
  modalAlignmentObserver.observe(modalBody,{childList:true,subtree:true});
}

window.addEventListener("resize",()=>{
  if(!modalBackdrop.hidden)requestAnimationFrame(alignModalCloseButton);
});
if(window.visualViewport){
  const syncLiveCloseToViewport=()=>{
    if(!modalBackdrop.hidden)requestAnimationFrame(alignModalCloseButton);
  };
  window.visualViewport.addEventListener("resize",syncLiveCloseToViewport);
  window.visualViewport.addEventListener("scroll",syncLiveCloseToViewport);
}

function flashMessage(msg){
  showModal(`<h2>Kelimelik</h2><p id="flashMessageText"></p>`);
  const target=$("#flashMessageText");
  if(target)target.textContent=String(msg??"");
}


function showDailyAlreadyPlayed(){
  const record=getTodayDailySummary();
  const resultText=record.won
    ? `Bugünün günlük bulmacasını ${record.tries} tahminde çözdün.`
    : "Bugünün günlük bulmacasını tamamladın.";

  showModal(`
    <h2>Günlük Bulmaca Tamamlandı</h2>
    <p>${resultText}</p>
    <p>Yeni günlük bulmaca yarın açılacak.</p>
    <button class="start-btn" id="dailyPracticeBtn">Kelimelik Modu Oyna →</button>
  `,{closeAction:showNewGameSelector});

  $("#dailyPracticeBtn").onclick=()=>{
    showClassicLengthSelector();
  };
}


function currentPuzzleShareToken(){
  if(gameMode==="daily"){
    return `gunluk-${todayKey()}`;
  }

  if(gameMode==="shared" && sharedPuzzleToken){
    return sharedPuzzleToken;
  }

  if(gameMode==="classic"){
    return `klasikmod-${COLS}-${gameAnswerVersion}-${gameSeed}`;
  }

  return `klasik-${COLS}-${gameAnswerVersion}-${gameSeed}`;
}

function parsePuzzleShareToken(token){
  const value=String(token||"").trim();

  const custom=value.match(/^ozel-([A-Z2-9]{7})$/i);
  if(custom){
    return {mode:"custom",code:custom[1].toUpperCase(),token:`ozel-${custom[1].toUpperCase()}`};
  }

  const daily=value.match(/^gunluk-(\d{4}-\d{2}-\d{2})$/i);
  if(daily){
    return {mode:"daily",date:daily[1],token:`gunluk-${daily[1]}`};
  }

  const classicMode=value.match(/^klasikmod-([456])-(A\d+)-([A-Z0-9]{1,8})$/i);
  if(classicMode){
    return {
      mode:"classic",
      length:Number(classicMode[1]),
      answerVersion:classicMode[2].toUpperCase(),
      seed:classicMode[3].toUpperCase(),
      token:`klasikmod-${classicMode[1]}-${classicMode[2].toUpperCase()}-${classicMode[3].toUpperCase()}`
    };
  }

  const classic=value.match(/^klasik-([456])-(A\d+)-([A-Z0-9]{1,8})$/i);
  if(classic){
    return {
      mode:"practice",
      length:Number(classic[1]),
      answerVersion:classic[2].toUpperCase(),
      seed:classic[3].toUpperCase(),
      token:`klasik-${classic[1]}-${classic[2].toUpperCase()}-${classic[3].toUpperCase()}`
    };
  }

  return null;
}

function buildShareText(won,tries){
  const limit=currentAttemptLimit();
  const modeText=gameMode==="daily"
    ? `Günün Bulmacası · ${formatDateTR(todayKey())}`
    : gameMode==="shared"
      ? "Paylaşılan Bulmaca"
      : gameMode==="classic"
        ? `Klasik Mod · ${COLS} Harf`
        : `Kelimelik Modu · ${COLS} Harf`;

  const rows=[];
  for(let r=0;r<limit;r++){
    if(!submitted[r] || !feedbacks[r])continue;
    const f=feedbacks[r];

    if(isClassicVariant()){
      const emoji={green:"🟩",yellow:"🟨",red:"🟥"};
      rows.push(f.pattern.map(state=>emoji[state]||"🟥").join(""));
    }else{
      rows.push(`🟩${f.green}  🟨${f.yellow}  🟥${f.red}`);
    }
  }

  const result=won ? `${tries}/${limit}` : `X/${limit}`;
  return `Kelimelik · ${modeText}\n${result}\n\n${rows.join("\n")}`;
}

function shareIconSVG(){
  return `
    <svg class="share-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4"></path>
      <path d="M8 8l4-4 4 4"></path>
      <path d="M5 12v7h14v-7"></path>
    </svg>
  `;
}

function cleanShareUrl(){
  if(typeof location==="undefined" || !String(location.protocol||"").startsWith("http")){
    return "";
  }

  const origin=String(location.origin||"").replace(/\/$/,"");
  let path=String(location.pathname||"/");

  path=path.replace(/\/index\.html?$/i,"/");
  if(!path.endsWith("/") && !/\.[a-z0-9]+$/i.test(path))path+="/";

  return origin ? `${origin}${path}` : "";
}

function currentPuzzleShareUrl(){
  const base=cleanShareUrl();
  if(!base)return "";

  const token=currentPuzzleShareToken();
  return `${base}?bulmaca=${encodeURIComponent(token)}`;
}

function showSharedAlreadyCompleted(record){
  const parsedToken=parsePuzzleShareToken(record?.sharedPuzzleToken||"");
  const sharedLength=Number(record?.length)||Number(record?.COLS)||Number(parsedToken?.length)||5;
  const limit=record?.gameVariant==="classic" || parsedToken?.mode==="classic" ? classicAttemptLimit(sharedLength) : 8;
  const result=record?.won
    ? `${Number(record.tries)||"?"}/${limit}`
    : `X/${limit}`;

  showHome();
  showModal(`
    <h2>Paylaşılan Bulmaca Tamamlandı</h2>
    <p>Bu paylaşılan bulmacayı daha önce tamamladın. Paylaşılan bulmacalar aynı tarayıcıda yalnızca bir kez oynanabilir.</p>
    ${record?.word
      ? `<p><b>${escapeHTML(record.word)} · ${result}</b></p>`
      : ""}
    <button class="start-btn" id="sharedDoneHomeBtn">Ana Sayfaya Dön</button>
  `);

  $("#sharedDoneHomeBtn").onclick=()=>{
    closeModal();
    showHome();
  };
}

function restoreSharedPuzzleProgress(token){
  clearPendingResultReveal();
  gameRunId++;
  const saved=getSharedPlay(token);
  if(!saved || saved.completed || saved.gameFinished)return false;

  try{
    const savedCols=Number(saved.COLS)||Number(saved.length)||5;
    if(![4,5,6].includes(savedCols))throw new Error("Geçersiz paylaşılan bulmaca uzunluğu");

    // Eski paylaşılan ilerlemeler A2'den önce A1 ile oluşturuldu.
    const answerVersion=typeof saved.gameAnswerVersion==="string"
      ? saved.gameAnswerVersion
      : "A1";

    setWordLength(savedCols,answerVersion);
    if(!saved.secretWord || !VALID_WORDS.has(saved.secretWord)){
      throw new Error("Paylaşılan bulmaca sözlükle uyumsuz");
    }

    if(!Array.isArray(saved.guesses) || saved.guesses.length!==ROWS){
      throw new Error("Paylaşılan bulmaca ilerlemesi geçersiz");
    }

    guesses=saved.guesses;
    feedbacks=Array.isArray(saved.feedbacks)
      ? saved.feedbacks
      : Array.from({length:ROWS},()=>null);
    submitted=Array.isArray(saved.submitted)
      ? saved.submitted
      : Array(ROWS).fill(false);
    activeRow=Math.max(0,Math.min((saved.gameVariant==="classic"?classicAttemptLimit(savedCols):8)-1,Number(saved.activeRow)||0));
    activeCol=Math.max(0,Math.min(COLS,Number(saved.activeCol)||0));
    secretWord=saved.secretWord;
    hintUsed=Boolean(saved.hintUsed);
    gameMode="shared";
    const parsedShared=parsePuzzleShareToken(token);
    gameVariant=saved.gameVariant==="classic" || parsedShared?.mode==="classic"
      ? "classic"
      : "kelimelik";
    gameFinished=false;
    gameSeed=String(saved.gameSeed||"");
    gameAnswerVersion=answerVersion;
    gameDailyVersion=String(saved.gameDailyVersion||"");
    sharedPuzzleToken=token;

    storageSet("kelimelik-game-v18",JSON.stringify({
      ...saved,
      gameMode:"shared",
      gameVariant,
      sharedPuzzleToken:token,
      gameFinished:false
    }));

    buildBoard();
    render();
    showGame();
    return true;
  }catch(e){
    const plays=loadSharedPlays();
    delete plays[token];
    saveSharedPlays(plays);
    return false;
  }
}

function prepareSharedPuzzleStart(token){
  const existing=getSharedPlay(token);

  if(existing?.completed){
    showSharedAlreadyCompleted(existing);
    return "completed";
  }

  if(restoreSharedPuzzleProgress(token)){
    return "restored";
  }

  return "new";
}

function completedDailyResultForDate(dateKey){
  const history=dailyHistoryResultForDate(dateKey);
  if(history){
    return {
      completed:true,
      won:Boolean(history.won),
      tries:history.won ? Number(history.tries)||null : null,
      word:history.won ? history.word : "",
      date:dateKey
    };
  }

  const record=loadDailyRecord();
  if(record?.date===dateKey && record.completed){
    return {
      completed:true,
      won:Boolean(record.won),
      tries:record.won ? Number(record.tries)||null : null,
      word:record.won ? normalizeStoredWord(record.word) : "",
      date:dateKey
    };
  }

  return null;
}

function startSharedDailyPuzzle(dateKey,token){
  clearPendingResultReveal();
  gameRunId++;

  const completedDaily=completedDailyResultForDate(dateKey);
  if(completedDaily?.completed){
    saveSharedPlay(token,{
      completed:true,
      won:Boolean(completedDaily.won),
      tries:completedDaily.won ? completedDaily.tries : null,
      word:completedDaily.won ? completedDaily.word : "",
      length:5,
      gameFinished:true,
      completedAt:new Date().toISOString()
    });
    showSharedAlreadyCompleted(completedDaily);
    return true;
  }

  const state=prepareSharedPuzzleStart(token);
  if(state!=="new")return true;

  try{
    const info=getDailyPuzzleInfo(dateKey);
    setWordLength(5,CURRENT_ANSWER_VERSION);

    gameMode="shared";
    gameVariant="kelimelik";
    sharedPuzzleToken=token;
    guesses=emptyRows();
    feedbacks=Array.from({length:ROWS},()=>null);
    submitted=Array(ROWS).fill(false);
    activeRow=0;
    activeCol=0;
    hintUsed=false;
    gameFinished=false;
    gameSeed=dateKey;
    gameAnswerVersion=CURRENT_ANSWER_VERSION;
    gameDailyVersion=info.version;
    secretWord=info.word;

    storageRemove("kelimelik-game-v18");
    buildBoard();
    render();
    showGame();
    return true;
  }catch(e){
    return false;
  }
}

function startSharedClassicPuzzle(puzzle){
  const state=prepareSharedPuzzleStart(puzzle.token);
  if(state!=="new")return true;

  const started=newGame(
    puzzle.mode==="classic" ? "classic" : "practice",
    puzzle.length,
    puzzle.seed,
    puzzle.answerVersion
  );

  if(!started)return false;

  gameMode="shared";
  gameVariant=puzzle.mode==="classic" ? "classic" : "kelimelik";
  sharedPuzzleToken=puzzle.token;
  gameFinished=false;
  render();
  showGame();
  return true;
}

function startSharedPuzzleFromUrl(){
  if(typeof location==="undefined" || !String(location.protocol||"").startsWith("http")){
    return false;
  }

  const search=String(location.search||"");
  const match=search.match(/[?&]bulmaca=([^&]+)/i);
  if(!match)return false;

  let token="";
  try{
    token=decodeURIComponent(match[1].replace(/\+/g," "));
  }catch(e){
    return false;
  }

  const puzzle=parsePuzzleShareToken(token);
  if(!puzzle)return false;

  if(puzzle.mode==="custom"){
    setTimeout(()=>startCustomPuzzleFromCode(puzzle.code),0);
    return true;
  }

  if(puzzle.mode==="daily"){
    return startSharedDailyPuzzle(puzzle.date,puzzle.token);
  }

  return startSharedClassicPuzzle(puzzle);
}

function showToast(message){
  let toast=document.getElementById?.("appToast") || null;

  if(!toast){
    toast=document.createElement("div");
    toast.id="appToast";
    toast.className="app-toast";
    toast.setAttribute?.("role","status");
    toast.setAttribute?.("aria-live","polite");
    document.body.appendChild(toast);
  }

  toast.textContent=message;
  toast.classList.remove("show");
  void toast.offsetWidth;
  toast.classList.add("show");
  setTimeout(()=>toast.classList.remove("show"),1800);
}

function buildPuzzleInviteText(){
  return "Kelimelik'te sana bir bulmaca gönderdim. Çözebilir misin?";
}

async function shareCurrentPuzzle(){
  if($("#gameScreen").hidden)return;

  const text=buildPuzzleInviteText();
  const url=currentPuzzleShareUrl();
  const clipboardText=url ? `${text}\n${url}` : text;

  try{
    if(navigator.share){
      const payload={title:"Kelimelik",text};
      if(url)payload.url=url;
      await navigator.share(payload);
      showToast("Bulmaca paylaşımı hazır.");
      return;
    }

    if(navigator.clipboard){
      await navigator.clipboard.writeText(clipboardText);
      showToast("Bulmaca bağlantısı panoya kopyalandı.");
      return;
    }

    showToast("Paylaşım bu tarayıcıda desteklenmiyor.");
  }catch(err){
    if(err?.name!=="AbortError"){
      showToast("Paylaşım açılamadı.");
    }
  }
}


function customPuzzleShareUrl(code){
  const base=cleanShareUrl();
  const clean=ONLINE?.cleanCustomPuzzleCode?.(code)||"";
  return base && clean ? `${base}?bulmaca=${encodeURIComponent(`ozel-${clean}`)}` : "";
}

function showShareMenu(){
  showModal(`
    <h2>Paylaş</h2>
    <p>Mevcut oyunu gönder veya arkadaşına özel bir kelime seç.</p>
    <div class="menu-list">
      <button class="menu-action" id="shareExistingPuzzleBtn">
        <b>🔗 Mevcut Bulmacayı Gönder</b>
        <small>Şu an oynadığın bulmacayı arkadaşın kendi zamanında çözsün.</small>
      </button>
      <button class="menu-action" id="createCustomPuzzleBtn">
        <b>✏️ Kendi Bulmacanı Oluştur</b>
        <small>Gizli kelimeyi sen seç. Cevap bağlantıda görünmez ve güvenli biçimde saklanır.</small>
      </button>
    </div>
  `);
  $("#shareExistingPuzzleBtn").onclick=()=>{closeModal();shareCurrentPuzzle();};
  $("#createCustomPuzzleBtn").onclick=showCustomPuzzleBuilder;
}

function showCustomPuzzleBackendRequired(){
  showModal(`
    <h2>Özel Bulmaca Şu Anda Kullanılamıyor</h2>
    <div class="online-required-card">
      <b>Özel bulmaca bağlantısı henüz etkin değil.</b>
      <p>Mevcut bulmacanı paylaşmaya devam edebilirsin.</p>
    </div>
    <button class="modal-back-btn" id="customBackendBackBtn">← Paylaş'a Dön</button>
  `,{closeAction:showShareMenu});
  $("#customBackendBackBtn").onclick=showShareMenu;
}

function showCustomPuzzleBuilder(){
  const profile=ONLINE?.getLocalProfile?.() || null;
  if(!profile){
    showProfileSetup({returnTo:showCustomPuzzleBuilder,backTo:showShareMenu,backLabel:"Paylaş'a Dön"});
    return;
  }
  if(!ONLINE?.isConfigured?.()){showCustomPuzzleBackendRequired();return;}
  showModal(`
    <h2>✏️ Kendi Bulmacanı Oluştur</h2>
    <p>Arkadaşına özel gizli kelime seç. Kelime URL'de hiçbir zaman yer almaz.</p>
    <section class="custom-puzzle-builder">
      <div class="live-mode-toggle" role="group" aria-label="Özel bulmaca modu">
        <button class="live-mode-btn active" data-custom-build-mode="kelimelik">◆ Kelimelik</button>
        <button class="live-mode-btn" data-custom-build-mode="classic">▦ Klasik</button>
      </div>
      <div class="live-length-wrap" id="customBuildLengthWrap">
        <span>Harf sayısı</span>
        <div class="live-length-toggle">
          <button data-custom-build-length="4">4</button>
          <button class="active" data-custom-build-length="5">5</button>
          <button data-custom-build-length="6">6</button>
        </div>
      </div>
      <label class="profile-label" for="customSecretInput">Gizli Kelime</label>
      <input class="profile-input custom-secret-input" id="customSecretInput" maxlength="6" autocomplete="off" spellcheck="false" placeholder="Örn. RÜŞEN">
      <p class="profile-help">Kelime tahmin sözlüğümüzde bulunmalı. Sözlüğe eklenmiş özel isimler de kullanılabilir.</p>
      <p class="profile-error" id="customPuzzleError" role="alert"></p>
      <button class="start-btn" id="createCustomPuzzleSubmit">Bulmacayı Oluştur</button>
    </section>
    <button class="modal-back-btn" id="customPuzzleBackBtn">← Paylaş'a Dön</button>
  `,{closeAction:showShareMenu});

  let mode="kelimelik";
  let length=5;
  const lengthWrap=$("#customBuildLengthWrap");
  const input=$("#customSecretInput");
  const errorEl=$("#customPuzzleError");

  document.querySelectorAll("[data-custom-build-mode]").forEach(btn=>btn.onclick=()=>{
    mode=btn.dataset.customBuildMode;
    document.querySelectorAll("[data-custom-build-mode]").forEach(x=>x.classList.toggle("active",x===btn));
    lengthWrap.hidden=false;
    input.maxLength=length;
    input.value=[...input.value].slice(0,length).join("");
    errorEl.textContent="";
  });
  document.querySelectorAll("[data-custom-build-length]").forEach(btn=>btn.onclick=()=>{
    length=Number(btn.dataset.customBuildLength);
    input.maxLength=length;
    input.value=[...input.value].slice(0,length).join("");
    document.querySelectorAll("[data-custom-build-length]").forEach(x=>x.classList.toggle("active",x===btn));
    errorEl.textContent="";
  });
  input.addEventListener("input",()=>{
    input.value=String(input.value||"").toLocaleUpperCase("tr-TR").replace(/[^A-ZÇĞİÖŞÜ]/g,"").slice(0,length);
    errorEl.textContent="";
  });
  input.focus();

  $("#createCustomPuzzleSubmit").onclick=async()=>{
    const answer=String(input.value||"").toLocaleUpperCase("tr-TR");
    if([...answer].length!==length){errorEl.textContent=`${length} harfli bir kelime gir.`;return;}
    const pool=WORD_POOLS[String(length)]||[];
    if(!pool.includes(answer)){errorEl.textContent="Bu kelime tahmin sözlüğümüzde bulunmuyor.";return;}
    const button=$("#createCustomPuzzleSubmit");
    button.disabled=true;button.textContent="Oluşturuluyor…";
    try{
      const created=await ONLINE.createCustomPuzzle(mode,length,answer);
      showCustomPuzzleCreated(created);
    }catch(error){
      errorEl.textContent=String(error?.message||"Özel bulmaca oluşturulamadı.");
      button.disabled=false;button.textContent="Bulmacayı Oluştur";
    }
  };
  $("#customPuzzleBackBtn").onclick=showShareMenu;
}

function showCustomPuzzleCreated(created){
  const code=ONLINE?.cleanCustomPuzzleCode?.(created?.puzzleCode)||"";
  const url=customPuzzleShareUrl(code);
  const modeText=created?.mode==="classic"?`Klasik · ${Number(created?.wordLength)||5} Harf`:`Kelimelik · ${Number(created?.wordLength)||5} Harf`;
  showModal(`
    <h2>Bulmaca Hazır ✓</h2>
    <div class="custom-created-card">
      <span>${escapeHTML(modeText)}</span>
      <strong>${escapeHTML(code)}</strong>
      <small>Gizli kelime bağlantıda bulunmuyor.</small>
    </div>
    <div class="profile-actions">
      <button class="start-btn" id="shareCustomPuzzleLinkBtn">Arkadaşına Gönder</button>
      <button class="modal-back-btn" id="copyCustomPuzzleLinkBtn">Bağlantıyı Kopyala</button>
    </div>
    <button class="modal-back-btn" id="createAnotherCustomBtn">Yeni Bir Bulmaca Oluştur</button>
  `,{closeAction:showShareMenu});
  $("#shareCustomPuzzleLinkBtn").onclick=async()=>{
    const text="Kelimelik'te sana özel bir bulmaca hazırladım. Çözebilir misin?";
    try{
      if(navigator.share){await navigator.share({title:"Kelimelik Özel Bulmaca",text,url});return;}
      await navigator.clipboard.writeText(`${text}\n${url}`);showToast("Özel bulmaca bağlantısı kopyalandı.");
    }catch(error){if(error?.name!=="AbortError")showToast("Paylaşım açılamadı.");}
  };
  $("#copyCustomPuzzleLinkBtn").onclick=async()=>{
    try{await navigator.clipboard.writeText(url);showToast("Bağlantı kopyalandı.");}
    catch(error){showToast("Bağlantı kopyalanamadı.");}
  };
  $("#createAnotherCustomBtn").onclick=showCustomPuzzleBuilder;
}

let customPuzzleSession=null;

function customPuzzleBoardHTML(state){
  const guesses=Array.isArray(state?.guesses)?state.guesses:[];
  const active=state?.status==="active" && Number(state.attemptsUsed)<Number(state.attemptLimit);
  const rows=[];
  for(let r=0;r<Number(state.attemptLimit);r++){
    const guess=guesses.find(item=>Number(item.guessNo)===r+1)||null;
    const isInput=active && r===Number(state.attemptsUsed);
    const chars=guess?[...String(guess.guessWord||"")]:isInput?[...(customPuzzleSession?.input||"")]:[];
    const pattern=Array.isArray(guess?.feedback?.pattern)?guess.feedback.pattern:[];
    const tiles=Array.from({length:Number(state.wordLength)},(_,c)=>{
      const klass=[];
      if(isInput && self && Number(liveMatchSession?.invalidInputUntil||0)>Date.now())klass.push("invalid-word");
      if(state.mode==="classic" && guess && pattern[c])klass.push(`feedback-${pattern[c]}`);
      if(state.mode==="kelimelik" && guess){
        const mark=customPuzzleSession?.marks?.[`${r}:${c}`]||"none";
        if(mark!=="none")klass.push(`manual-${mark}`);
      }
      const markAttr=state.mode==="kelimelik" && guess
        ? ` data-custom-mark-row="${r}" data-custom-mark-col="${c}" role="button" tabindex="0"`
        : "";
      return `<span class="live-tile ${klass.join(" ")}"${markAttr}>${escapeHTML(chars[c]||"")}</span>`;
    }).join("");
    rows.push(`<div class="live-board-row ${isInput?"is-input":""}"><div class="live-tiles" style="--live-cols:${state.wordLength}">${tiles}</div>${state.mode==="kelimelik"?liveCounterHTML(guess?.feedback||null):""}</div>`);
  }
  return `<div class="live-board custom-puzzle-board">${rows.join("")}</div>`;
}

function buildOnlineKeyboardState(mode,guesses){
  const used=new Set();
  const feedback={};
  const rank={red:1,yellow:2,green:3};

  (Array.isArray(guesses)?guesses:[]).forEach(guess=>{
    const letters=[...String(guess?.guessWord||"")];
    const pattern=Array.isArray(guess?.feedback?.pattern)?guess.feedback.pattern:[];
    letters.forEach((letter,index)=>{
      const ch=String(letter||"").toLocaleUpperCase("tr-TR");
      if(!ch)return;
      used.add(ch);
      if(mode!=="classic")return;
      const state=String(pattern[index]||"");
      if(!rank[state])return;
      const previous=feedback[ch];
      if(!previous || rank[state]>rank[previous])feedback[ch]=state;
    });
  });

  return {used,feedback};
}

function onlineKeyboardClass(keyState,letter){
  const ch=String(letter||"").toLocaleUpperCase("tr-TR");
  const feedback=keyState?.feedback?.[ch];
  if(feedback)return ` feedback-${feedback}`;
  return keyState?.used?.has?.(ch)?" used":"";
}

function customPuzzleKeyboardHTML(state){
  const hintDisabled=Number(state?.attemptsUsed||0)<1 || Boolean(state?.hintUsed);
  const hintButton=state?.mode==="kelimelik"
    ? `<button class="custom-hint-btn" data-custom-action="hint" ${hintDisabled?"disabled":""}>💡 ${state?.hintUsed?"İpucu Kullanıldı":"İpucu"}</button>`
    : "";
  const keyState=buildOnlineKeyboardState(state?.mode,state?.guesses);
  return `<div class="live-keyboard custom-puzzle-keyboard">
    ${LIVE_KEYBOARD_ROWS.map((row,index)=>`<div class="live-key-row">${row.map(ch=>`<button class="live-key${onlineKeyboardClass(keyState,ch)}" data-custom-letter="${ch}">${ch}</button>`).join("")}${index===2?'<button class="live-key live-key-action" data-custom-action="backspace" aria-label="Son harfi sil">⌫</button>':""}</div>`).join("")}
    <div class="live-key-row live-submit-row custom-submit-row">${hintButton}<button class="live-submit-btn" data-custom-action="submit">Tahmini Gönder ✓</button></div>
  </div>`;
}

function customPuzzleResultHTML(state){
  if(state.status!=="ended")return "";
  const title=state.won?"Tebrikler! 🎉":"Bulmaca Tamamlandı";
  const result=state.won?`${state.attemptsUsed}/${state.attemptLimit}`:`X/${state.attemptLimit}`;
  return `<section class="live-result-card custom-puzzle-result">
    <h3>${title}</h3>
    <div class="custom-answer-word">${escapeHTML(state.answerWord||"")}</div>
    <p>${state.won?`<b>${result}</b> tahminde çözdün.`:`Cevap <b>${escapeHTML(state.answerWord||"")}</b> idi.`}</p>
    <div class="live-result-actions">
      <button class="start-btn" id="shareCustomResultBtn">Bulmacayı Paylaş</button>
      <button class="modal-back-btn" id="customPuzzleHomeBtn">Ana Sayfaya Dön</button>
    </div>
  </section>`;
}

function renderCustomPuzzle(){
  const state=customPuzzleSession?.state;
  const root=$("#customPuzzleRoot");
  if(!state||!root)return;
  const modeText=state.mode==="classic"?`Klasik · ${state.wordLength} Harf`:`Kelimelik · ${state.wordLength} Harf`;
  const creator=state.creator?.nickname
    ? `<button class="custom-creator" id="customCreatorProfileBtn"><span>Hazırlayan</span><b>${escapeHTML(state.creator.nickname)}</b><small>#${escapeHTML(state.creator.playerCode||"-----")}</small></button>`
    : `<div class="custom-creator"><span>Arkadaşından özel bulmaca</span></div>`;
  root.innerHTML=`<div class="live-match-shell custom-puzzle-shell" id="customPuzzleShell">
    <header class="live-match-head"><div><span>ÖZEL BULMACA</span><h2>${escapeHTML(modeText)}</h2></div><div class="custom-code-chip">${escapeHTML(state.puzzleCode)}</div></header>
    ${creator}
    ${customPuzzleBoardHTML(state)}
    ${state.status==="active"?customPuzzleKeyboardHTML(state):""}
    ${customPuzzleResultHTML(state)}
  </div>`;
  bindCustomPuzzleUI();
}

function bindCustomPuzzleUI(){
  document.querySelectorAll("[data-custom-letter]").forEach(btn=>btn.onclick=()=>customPuzzleAddLetter(btn.dataset.customLetter));
  document.querySelector('[data-custom-action="backspace"]')?.addEventListener("click",customPuzzleBackspace);
  document.querySelector('[data-custom-action="submit"]')?.addEventListener("click",submitCustomPuzzleGuess);
  document.querySelector('[data-custom-action="hint"]')?.addEventListener("click",useCustomPuzzleHint);
  document.querySelectorAll("[data-custom-mark-row]").forEach(tile=>{
    const cycle=()=>cycleCustomPuzzleMark(Number(tile.dataset.customMarkRow),Number(tile.dataset.customMarkCol));
    tile.onclick=cycle;tile.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();cycle();}};
  });
  $("#shareCustomResultBtn")?.addEventListener("click",shareCustomPuzzleResult);
  $("#customPuzzleHomeBtn")?.addEventListener("click",exitCustomPuzzle);
  $("#customCreatorProfileBtn")?.addEventListener("click",()=>{
    const code=customPuzzleSession?.state?.creator?.playerCode;
    if(code)showPublicPlayerProfile(code,{returnTo:resumeCustomPuzzleModal});
  });
}

function customPuzzleCanType(){
  const state=customPuzzleSession?.state;
  return Boolean(state && state.status==="active" && !customPuzzleSession.submitting && Number(state.attemptsUsed)<Number(state.attemptLimit));
}

function customPuzzleAddLetter(letter){
  if(!customPuzzleCanType())return;
  if([...customPuzzleSession.input].length>=Number(customPuzzleSession.state.wordLength))return;
  customPuzzleSession.input+=String(letter||"").toLocaleUpperCase("tr-TR");
  renderCustomPuzzle();
}

function customPuzzleBackspace(){
  if(!customPuzzleCanType())return;
  customPuzzleSession.input=[...customPuzzleSession.input].slice(0,-1).join("");
  renderCustomPuzzle();
}

function cycleCustomPuzzleMark(row,col){
  if(!customPuzzleSession)return;
  const key=`${row}:${col}`;
  const order=["none","red","yellow","green"];
  const current=customPuzzleSession.marks[key]||"none";
  customPuzzleSession.marks[key]=order[(order.indexOf(current)+1)%order.length];
  renderCustomPuzzle();
}

async function useCustomPuzzleHint(){
  const state=customPuzzleSession?.state;
  if(!state || state.mode!=="kelimelik" || state.status!=="active" || state.hintUsed)return;
  if(Number(state.attemptsUsed)<1){showToast("İpucu için önce en az bir tahmin gönder.");return;}
  customPuzzleSession.submitting=true;renderCustomPuzzle();
  try{
    const previous=Array.isArray(state.guesses)?state.guesses.length:0;
    customPuzzleSession.state=await ONLINE.useCustomPuzzleHint(state.puzzleCode);
    customPuzzleSession.input="";
    const guesses=Array.isArray(customPuzzleSession.state?.guesses)?customPuzzleSession.state.guesses:[];
    const hintWord=guesses.length>previous?guesses[guesses.length-1]?.guessWord:"";
    if(hintWord)showToast(`İpucu kullanıldı: ${hintWord}`);
  }catch(error){showToast(String(error?.message||"İpucu kullanılamadı."));}
  finally{if(customPuzzleSession){customPuzzleSession.submitting=false;renderCustomPuzzle();}}
}

async function submitCustomPuzzleGuess(){
  if(!customPuzzleCanType())return;
  const state=customPuzzleSession.state;
  const guess=customPuzzleSession.input;
  if([...guess].length!==Number(state.wordLength)){showToast(`${state.wordLength} harf gir.`);return;}
  customPuzzleSession.submitting=true;renderCustomPuzzle();
  try{
    customPuzzleSession.state=await ONLINE.submitCustomPuzzleGuess(state.puzzleCode,guess);
    customPuzzleSession.input="";
  }catch(error){showToast(String(error?.message||"Tahmin gönderilemedi."));}
  finally{if(customPuzzleSession){customPuzzleSession.submitting=false;renderCustomPuzzle();}}
}

function handleCustomPuzzlePhysicalKey(e){
  if(!customPuzzleSession || !$("#customPuzzleShell"))return false;
  if(e.ctrlKey||e.metaKey||e.altKey)return false;
  if(e.key==="Backspace"){e.preventDefault();customPuzzleBackspace();return true;}
  if(e.key==="Enter"){e.preventDefault();submitCustomPuzzleGuess();return true;}
  if(typeof e.key==="string" && e.key.length===1){
    const letter=e.key.toLocaleUpperCase("tr-TR");
    if(PHYSICAL_KEY_LETTERS.has(letter)){e.preventDefault();customPuzzleAddLetter(letter);return true;}
  }
  return false;
}

function resumeCustomPuzzleModal(){
  if(!customPuzzleSession)return showHome();
  showModal('<div id="customPuzzleRoot"></div>',{closeAction:exitCustomPuzzle,bodyClass:"live-match-modal-body"});
  renderCustomPuzzle();
}

function clearCustomPuzzleUrl(){
  if(!history?.replaceState)return;
  try{
    const url=new URL(location.href);
    const token=url.searchParams.get("bulmaca")||"";
    if(/^ozel-[A-Z2-9]{7}$/i.test(token))url.searchParams.delete("bulmaca");
    history.replaceState(null,"",`${url.pathname}${url.search}${url.hash}`);
  }catch(e){}
}

function exitCustomPuzzle(){
  customPuzzleSession=null;
  clearCustomPuzzleUrl();
  closeModal();
  showHome();
}

async function shareCustomPuzzleResult(){
  const state=customPuzzleSession?.state;
  if(!state)return;
  const result=state.won?`${state.attemptsUsed}/${state.attemptLimit}`:`X/${state.attemptLimit}`;
  const text=`KELİMELİK · Özel Bulmaca\n${state.mode==="classic"?`Klasik · ${state.wordLength} Harf`:`Kelimelik · ${state.wordLength} Harf`}\n${result}`;
  const url=customPuzzleShareUrl(state.puzzleCode);
  try{
    if(navigator.share){await navigator.share({title:"Kelimelik Özel Bulmaca",text,url});return;}
    await navigator.clipboard.writeText(`${text}\n\n${url}`);showToast("Özel bulmaca sonucu kopyalandı.");
  }catch(error){if(error?.name!=="AbortError")showToast("Paylaşım açılamadı.");}
}

async function startCustomPuzzleFromCode(code){
  showHome();
  if(!ONLINE?.isConfigured?.()){
    showModal(`<h2>Özel Bulmaca Açılamadı</h2><p>Bu özel bulmaca için çevrimiçi bağlantı henüz etkin değil.</p><button class="start-btn" id="customUnavailableHomeBtn">Ana Sayfa</button>`);
    $("#customUnavailableHomeBtn").onclick=()=>{clearCustomPuzzleUrl();closeModal();showHome();};
    return;
  }
  showModal(`<div class="live-joining"><span class="meaning-spinner" aria-hidden="true"></span><h2>Özel Bulmaca Açılıyor</h2><p>Kod: <b>${escapeHTML(code)}</b></p></div>`,{closeAction:exitCustomPuzzle});
  try{
    const state=await ONLINE.getCustomPuzzle(code);
    customPuzzleSession={state,input:"",marks:{},submitting:false};
    resumeCustomPuzzleModal();
  }catch(error){
    customPuzzleSession=null;
    showModal(`<h2>Bulmaca Açılamadı</h2><p>${escapeHTML(String(error?.message||"Özel bulmaca bulunamadı."))}</p><button class="start-btn" id="customErrorHomeBtn">Ana Sayfa</button>`);
    $("#customErrorHomeBtn").onclick=()=>{clearCustomPuzzleUrl();closeModal();showHome();};
  }
}

async function sharePuzzle(won,tries){
  const text=buildShareText(won,tries);
  const url=currentPuzzleShareUrl();
  const clipboardText=url ? `${text}\n\n${url}` : text;

  try{
    if(navigator.share){
      const payload={title:"Kelimelik",text};
      if(url)payload.url=url;
      await navigator.share(payload);
      showToast("Paylaşım hazır.");
      return;
    }

    if(navigator.clipboard){
      await navigator.clipboard.writeText(clipboardText);
      showToast("Sonuç ve bağlantı panoya kopyalandı.");
      return;
    }

    showToast("Paylaşım bu tarayıcıda desteklenmiyor.");
  }catch(err){
    if(err?.name!=="AbortError"){
      showToast("Paylaşım açılamadı.");
    }
  }
}

function showResultModal(won,tries){
  const limit=currentAttemptLimit();
  const resultHero=won
    ? `
      <div class="result-hero win">
        <span class="result-badge">KAZANDIN</span>
        <h2><span>Tebrikler!</span><span class="result-celebration" aria-hidden="true">🎉</span></h2>
        <p><b>${tries}/${limit}</b> tahminde çözdün.</p>
      </div>
    `
    : `
      <div class="result-hero lose">
        <span class="result-badge">OYUN BİTTİ</span>
        <h2>Bu kez olmadı.</h2>
        <p>${limit} tahmin tamamlandı.</p>
      </div>
    `;

  showModal(`
    ${resultHero}

    ${resultWordActionsHTML()}

    <div class="result-actions">
      <button class="share-btn" id="shareResultBtn">
        ${shareIconSVG()}<span>Bulmacayı Paylaş</span>
      </button>
      <button class="start-btn result-new-game-btn ${loadSettings().animations?"result-new-game-animated":""}" id="modalNewGame">
        <span>Yeni Oyun</span><b aria-hidden="true">→</b>
      </button>
    </div>
  `);

  bindResultWordActions({won,tries});
  $("#shareResultBtn").onclick=()=>sharePuzzle(won,won?tries:null);
  $("#modalNewGame").onclick=()=>{
    closeModal();
    showNewGameSelector();
  };
}

function showWin(tries){
  clearPendingResultReveal();
  if(!gameFinished)recordGameResult(true,tries);
  launchConfetti();
  showResultModal(true,tries);
}

function showLose(){
  clearPendingResultReveal();
  if(!gameFinished)recordGameResult(false,null);
  showResultModal(false,null);
}

function showHowTo(){
  showModal(`
    <div class="howto">
      <h2>Nasıl oynanır?</h2>

      <p class="howto-lead">
        Gizli Türkçe kelimeyi tahmin ederek bul. Oynanış seçtiğin moda göre değişir.
        Bir kelime yazıp <b>✓</b> butonuna veya bilgisayarda <b>Enter</b> tuşuna basarak tahminini gönderirsin.
      </p>

      <h3>◆ Kelimelik Modu</h3>
      <p>
        4, 5 veya 6 harfli kelimeyi <b>8 tahminde</b> bulursun.
        Harflerin tek tek sonucu gösterilmez; satırın sağındaki üç sayaç toplam geri bildirim verir.
      </p>

      <div class="howto-feedback">
        <div><span class="howto-dot green"></span><b>Yeşil</b><small>Doğru harf, doğru konum.</small></div>
        <div><span class="howto-dot yellow"></span><b>Sarı</b><small>Doğru harf, yanlış konum.</small></div>
        <div><span class="howto-dot red"></span><b>Kırmızı</b><small>Kelimede bulunmayan harf.</small></div>
      </div>

      <p>
        Gönderilmiş harf kutularına tıklayarak kendi notlarını ekleyebilirsin.
        İpucu, en az bir tahminden sonra oyun başına bir kez kullanılabilir.
      </p>

      <h3>▦ Klasik Mod</h3>
      <p>
        4, 5 veya 6 harf seçebilirsin. 4 harfte <b>5</b>, 5 harfte <b>6</b>, 6 harfte <b>7 tahmin</b> hakkın vardır.
        Her tahminden sonra harf kutuları sonucu doğrudan yeşil, sarı veya kırmızı gösterir.
      </p>
      <p>Klasik Modda manuel harf işaretleme ve ipucu kullanılmaz.</p>

      <h3>📅 Günlük Bulmaca</h3>
      <p>
        Her gün aynı 5 harfli Kelimelik bulmacası oynanır ve günde bir kez tamamlanabilir.
        Yarım bırakırsan aynı gün kaldığın yerden devam edersin.
      </p>

      <h3>Kelime ve tahmin kuralları</h3>
      <ul class="howto-rules">
        <li>Tahmin, seçilen uzunlukta geçerli bir kelime olmalıdır.</li>
        <li>Eksik veya geçerli olmayan bir kelime gönderilirse tahmin hakkın azalmaz.</li>
        <li>Aynı harf bir kelimede birden fazla kez bulunabilir.</li>
      </ul>

      <h3>Klavye</h3>
      <p>
        Ekrandaki Türkçe Q klavyeyi veya bilgisayar klavyeni kullanabilirsin.
        <b>Backspace</b> son harfi siler, <b>Enter</b> tahmini gönderir.
      </p>
    </div>
  `);
}

function showClassicLengthSelector(){
  showModal(`
    <h2>Kelimelik Modu</h2>
    <p>Kelime uzunluğunu seç. 8 tahminde sayaçları kullanarak çöz.</p>

    <div class="length-options">
      <button class="length-btn" data-length="4">4<small>harf</small></button>
      <button class="length-btn" data-length="5">5<small>harf</small></button>
      <button class="length-btn" data-length="6">6<small>harf</small></button>
    </div>

  `,{closeAction:showNewGameSelector});

  document.querySelectorAll(".length-btn").forEach(btn=>{
    btn.onclick=()=>{
      const length=Number(btn.dataset.length);
      closeModal();
      newGame("practice",length);
      showGame();
    };
  });
}

function showDirectClassicLengthSelector(){
  showModal(`
    <h2>Klasik Mod</h2>
    <p>Kelime uzunluğunu seç. Harfler her tahminden sonra doğrudan renklenir.</p>

    <div class="length-options classic-length-options">
      <button class="length-btn" data-classic-length="4">
        4<small>harf · 5 tahmin</small>
      </button>
      <button class="length-btn classic-standard-option" data-classic-length="5">
        5<small>harf · 6 tahmin</small>
        <span class="classic-standard-badge">standart</span>
      </button>
      <button class="length-btn" data-classic-length="6">
        6<small>harf · 7 tahmin</small>
      </button>
    </div>

  `,{closeAction:showNewGameSelector});

  document.querySelectorAll("[data-classic-length]").forEach(btn=>{
    btn.onclick=()=>{
      const length=Number(btn.dataset.classicLength);
      closeModal();
      if(newGame("classic",length))showGame();
    };
  });
}

function playerInitials(nickname){
  const parts=String(nickname||"").trim().split(/\s+/).filter(Boolean);
  if(!parts.length)return "K";
  return parts.slice(0,2).map(part=>part[0]||"").join("").toLocaleUpperCase("tr-TR");
}

function profileCardHTML(profile){
  const nickname=escapeHTML(profile?.nickname||"Oyuncu");
  const code=escapeHTML(profile?.playerCode||"-----");
  return `
    <div class="profile-card">
      <div class="profile-avatar" aria-hidden="true">${escapeHTML(playerInitials(profile?.nickname))}</div>
      <div class="profile-main">
        <b>${nickname}</b>
        <span class="profile-code">#${code}</span>
      </div>
    </div>
  `;
}

function showProfileSetup({returnTo=null,editing=false,backTo=null}={}){
  const current=ONLINE?.getLocalProfile?.() || null;
  const title=editing?"Profili Düzenle":"Oyuncu Profilin";
  const lead=editing
    ? "Takma adını değiştirebilirsin. Oyuncu kodun aynı kalır."
    : "Online oyunlar için önce bir takma ad seç.";
  const closeTarget=editing
    ? (typeof returnTo==="function"?returnTo:null)
    : (typeof backTo==="function"?backTo:null);

  showModal(`
    <h2>${title}</h2>
    <p>${lead}</p>
    <form class="profile-form" id="profileForm" novalidate>
      <label class="profile-label" for="profileNickname">Takma Ad</label>
      <input class="profile-input" id="profileNickname" maxlength="18" autocomplete="nickname" value="${escapeHTML(current?.nickname||"")}">
      <p class="profile-help">2–18 karakter. Aynı takma adı başka oyuncular da kullanabilir; oyuncu kodun seni ayırır.</p>
      <p class="profile-error" id="profileError" role="alert"></p>
      <button class="start-btn" id="saveProfileBtn" type="submit">${editing?"Kaydet":"Profili Oluştur"}</button>
    </form>
  `,{closeAction:closeTarget});

  const input=$("#profileNickname");
  const form=$("#profileForm");
  const errorEl=$("#profileError");
  const button=$("#saveProfileBtn");
  input?.focus();

  form.onsubmit=async event=>{
    event.preventDefault();
    const valid=ONLINE?.validateNickname?.(input.value) || {ok:false,message:"Profil sistemi yüklenemedi."};
    if(!valid.ok){
      errorEl.textContent=valid.message;
      return;
    }

    button.disabled=true;
    button.textContent="Kaydediliyor…";
    errorEl.textContent="";

    try{
      const profile=await ONLINE.saveProfile(valid.nickname);
      showToast(profile.synced?"Online profil hazır.":"Profil bu cihaza kaydedildi.");
      if(typeof returnTo==="function")returnTo();
      else showProfileModal();
    }catch(error){
      errorEl.textContent=String(error?.message||"Profil kaydedilemedi.");
      button.disabled=false;
      button.textContent=editing?"Kaydet":"Profili Oluştur";
    }
  };
}

function multiplayerStatsFromRemote(profile){
  const source=profile?.stats;
  if(!source || typeof source!=="object")return null;
  return {
    overall:normalizeMultiplayerBucket(source.overall),
    kelimelik:normalizeMultiplayerBucket(source.kelimelik),
    classic:normalizeMultiplayerBucket(source.classic)
  };
}

async function refreshOwnOnlineStats(){
  const local=ONLINE?.getLocalProfile?.();
  if(!local?.playerCode || !ONLINE?.isConfigured?.())return loadMultiplayerStats();
  try{
    const remote=await ONLINE.getPublicProfile(local.playerCode);
    const stats=multiplayerStatsFromRemote(remote);
    if(stats){saveMultiplayerStats(stats);return stats;}
  }catch(error){
    console.warn("Multiplayer istatistikleri alınamadı:",error);
  }
  return loadMultiplayerStats();
}

function showProfileModal(){
  const profile=ONLINE?.getLocalProfile?.() || null;
  if(!profile){
    showProfileSetup();
    return;
  }

  showModal(`
    <h2>Profil</h2>
    ${profileCardHTML(profile)}
    <div class="profile-actions">
      <button class="modal-back-btn" id="editProfileBtn">Takma Adı Düzenle</button>
      <button class="modal-back-btn" id="profileStatsBtn">İstatistikler</button>
      <button class="modal-back-btn" id="profileSettingsBtn">Ayarlar</button>
    </div>
  `);

  $("#editProfileBtn").onclick=()=>showProfileSetup({returnTo:showProfileModal,editing:true});
  $("#profileStatsBtn").onclick=()=>openStatsModal("overall");
  $("#profileSettingsBtn").onclick=showSettingsModal;
}


function publicProfileModeRow(label,bucket){
  const clean=normalizeMultiplayerBucket(bucket);
  const rate=clean.matches?Math.round((clean.wins/clean.matches)*100):0;
  return `<div class="public-mode-row"><b>${escapeHTML(label)}</b><span>${clean.wins} galibiyet · %${rate}</span></div>`;
}

function headToHeadHTML(profile,h2h){
  const total=Number(h2h?.totalMatches)||0;
  if(!total)return `<section class="h2h-card empty"><h3>İkili Geçmiş</h3><p>Henüz bu oyuncuyla tamamlanmış maçın yok.</p></section>`;
  const local=ONLINE?.getLocalProfile?.();
  const last=Array.isArray(h2h?.lastFive)?h2h.lastFive:[];
  const dots=last.map(item=>item.result==="win"?"🟢":item.result==="loss"?"🔴":"🟡").join(" ");
  return `<section class="h2h-card">
    <h3>${escapeHTML(local?.nickname||"Sen")} vs ${escapeHTML(profile?.nickname||"Rakip")}</h3>
    <strong>${total} maç · ${Number(h2h.myWins)||0} — ${Number(h2h.opponentWins)||0}</strong>
    ${Number(h2h.draws)?`<small>${Number(h2h.draws)} beraberlik</small>`:""}
    ${last.length?`<div class="h2h-last"><span>Son ${last.length} maç</span><b>${dots}</b></div>`:""}
  </section>`;
}

async function showPublicPlayerProfile(playerCode,{returnTo=null}={}){
  const code=String(playerCode||"").replace(/^#/,"").toUpperCase();
  if(!ONLINE?.isConfigured?.()){
    showOnlineSetupRequired(typeof returnTo==="function"?returnTo:showMultiplayerMenu);
    return;
  }
  showModal(`<div class="profile-loading"><span class="meaning-spinner" aria-hidden="true"></span><h2>Oyuncu Profili</h2><p>#${escapeHTML(code)} yükleniyor…</p></div>`,{closeAction:returnTo});
  try{
    const [profile,h2h]=await Promise.all([
      ONLINE.getPublicProfile(code),
      ONLINE.getHeadToHead(code).catch(error=>{console.warn("İkili geçmiş alınamadı:",error);return null;})
    ]);
    if(!profile)throw new Error("Oyuncu bulunamadı.");
    const stats=multiplayerStatsFromRemote(profile)||{overall:emptyMultiplayerStatBucket(),kelimelik:emptyMultiplayerStatBucket(),classic:emptyMultiplayerStatBucket()};
    const overall=stats.overall;
    const rate=overall.matches?Math.round((overall.wins/overall.matches)*100):0;
    const avgGuess=overall.solvedMatches?(overall.totalSolveGuesses/overall.solvedMatches).toFixed(1):"—";
    const remoteProfile={nickname:profile.nickname,playerCode:profile.player_code,synced:true};
    showModal(`
      <h2>Oyuncu Profili</h2>
      ${profileCardHTML(remoteProfile)}
      <div class="stats-grid public-profile-stats">
        <div class="stat-card"><b>${overall.matches}</b><span>Maç</span></div>
        <div class="stat-card"><b>%${rate}</b><span>Kazanma</span></div>
        <div class="stat-card"><b>${overall.currentStreak}</b><span>Seri</span></div>
        <div class="stat-card"><b>${avgGuess}</b><span>Ort. tahmin</span></div>
      </div>
      <div class="public-mode-list">
        ${publicProfileModeRow("◆ Kelimelik",stats.kelimelik)}
        ${publicProfileModeRow("▦ Klasik",stats.classic)}
      </div>
      ${headToHeadHTML(remoteProfile,h2h)}
      <div class="profile-public-note">Bu profilde yalnızca oyun bilgileri gösterilir. E-posta ve hesap kurtarma bilgileri public değildir.</div>
      ${typeof returnTo==="function"?'<button class="start-btn" id="publicProfileReturnBtn">Maça Dön</button>':'<button class="modal-back-btn" id="publicProfileCloseBtn">Kapat</button>'}
    `,{closeAction:returnTo});
    $("#publicProfileReturnBtn")?.addEventListener("click",returnTo);
    $("#publicProfileCloseBtn")?.addEventListener("click",closeModal);
  }catch(error){
    showModal(`<h2>Profil Açılamadı</h2><p>${escapeHTML(String(error?.message||"Oyuncu profili alınamadı."))}</p><button class="modal-back-btn" id="publicProfileErrorBack">Geri Dön</button>`,{closeAction:returnTo});
    $("#publicProfileErrorBack").onclick=typeof returnTo==="function"?returnTo:closeModal;
  }
}

function returnFromLiveOpponentProfile(){
  if(!liveMatchSession)return showMultiplayerMenu();
  showModal('<div id="liveMatchRoot"></div>',{closeAction:handleLiveMatchClose,bodyClass:"live-match-modal-body"});
  renderLiveMatch();
}

function openLiveOpponentProfile(){
  const opponent=liveMatchSession?.state?.opponent;
  if(!opponent || opponent.isBot || !opponent.playerCode)return;
  /* Profil açıkken heartbeat/realtime çalışmaya devam eder; oyuncu profiline bakmak disconnect sayılmaz. */
  showPublicPlayerProfile(opponent.playerCode,{returnTo:returnFromLiveOpponentProfile});
}

const LIVE_REACTIONS=["👍","👏","🔥","😅","😮","💀"];
const LIVE_KEYBOARD_ROWS=[
  ["Q","W","E","R","T","Y","U","I","O","P","Ğ","Ü"],
  ["A","S","D","F","G","H","J","K","L","Ş","İ"],
  ["Z","X","C","V","B","N","M","Ö","Ç"]
];
let liveMatchSession=null;
let liveRefreshTimer=null;
let quickMatchSession=null;

function liveRoomCodeFromUrl(){
  try{
    const value=new URL(location.href).searchParams.get("oda")||"";
    const valid=ONLINE?.validateRoomCode?.(value);
    return valid?.ok?valid.roomCode:"";
  }catch(e){return "";}
}

function liveRoomUrl(roomCode){
  try{
    const url=new URL(location.href);
    url.searchParams.delete("bulmaca");
    url.searchParams.set("oda",roomCode);
    url.hash="";
    return url.toString();
  }catch(e){return "";}
}

function updateLiveRoomUrl(roomCode){
  if(!history?.replaceState)return;
  try{
    const url=new URL(location.href);
    url.searchParams.delete("bulmaca");
    if(roomCode)url.searchParams.set("oda",roomCode);
    else url.searchParams.delete("oda");
    history.replaceState(null,"",`${url.pathname}${url.search}${url.hash}`);
  }catch(e){}
}

function showOnlineSetupRequired(returnTo=showMultiplayerMenu){
  showModal(`
    <h2>Çevrimiçi Oyun Henüz Etkin Değil</h2>
    <div class="online-required-card">
      <b>Çevrimiçi oyun bağlantısı şu anda kapalı.</b>
      <p>Günlük Bulmaca, Kelimelik Modu ve Klasik Mod oynanabilir.</p>
    </div>
  `,{closeAction:returnTo});
}

function showFriendLiveSetup(){
  const profile=ONLINE?.getLocalProfile?.() || null;
  if(!profile){
    showProfileSetup({returnTo:showFriendLiveSetup,backTo:showNewGameSelector});
    return;
  }
  if(!ONLINE?.isConfigured?.()){
    showOnlineSetupRequired(showMultiplayerMenu);
    return;
  }

  showModal(`
    <h2>Arkadaşınla Oyna</h2>
    <p>Özel oda oluştur veya 6 haneli oda koduyla katıl.</p>

    <section class="live-setup-card">
      <h3>Yeni Oda</h3>
      <div class="live-mode-toggle" role="group" aria-label="Canlı oyun modu">
        <button class="live-mode-btn active" data-live-mode="kelimelik">◆ Kelimelik</button>
        <button class="live-mode-btn" data-live-mode="classic">▦ Klasik</button>
      </div>
      <div class="live-length-wrap" id="liveLengthWrap">
        <span>Harf sayısı</span>
        <div class="live-length-toggle">
          <button data-live-length="4">4</button>
          <button class="active" data-live-length="5">5</button>
          <button data-live-length="6">6</button>
        </div>
      </div>
      <button class="start-btn" id="createLiveRoomBtn">Özel Oda Oluştur</button>
    </section>

    <div class="live-setup-divider"><span>veya</span></div>

    <form class="live-join-form" id="liveJoinForm" novalidate>
      <label for="liveRoomCodeInput">Oda Kodu</label>
      <div class="live-join-row">
        <input id="liveRoomCodeInput" maxlength="6" inputmode="text" autocomplete="off" placeholder="Örn. A4C9F2">
        <button class="compact-action" type="submit">Odaya Katıl</button>
      </div>
      <p class="profile-error" id="liveJoinError" role="alert"></p>
    </form>

  `,{closeAction:showMultiplayerMenu});

  let selectedMode="kelimelik";
  let selectedLength=5;
  const lengthWrap=$("#liveLengthWrap");

  document.querySelectorAll("[data-live-mode]").forEach(btn=>{
    btn.onclick=()=>{
      selectedMode=btn.dataset.liveMode;
      document.querySelectorAll("[data-live-mode]").forEach(x=>x.classList.toggle("active",x===btn));
      lengthWrap.hidden=false;
    };
  });
  document.querySelectorAll("[data-live-length]").forEach(btn=>{
    btn.onclick=()=>{
      selectedLength=Number(btn.dataset.liveLength);
      document.querySelectorAll("[data-live-length]").forEach(x=>x.classList.toggle("active",x===btn));
    };
  });

  $("#createLiveRoomBtn").onclick=async()=>{
    const button=$("#createLiveRoomBtn");
    button.disabled=true;
    button.textContent="Oda oluşturuluyor…";
    try{
      const state=await ONLINE.createPrivateMatch(selectedMode,selectedLength);
      openLiveMatch(state);
    }catch(error){
      showToast(String(error?.message||"Oda oluşturulamadı."));
      button.disabled=false;
      button.textContent="Özel Oda Oluştur";
    }
  };

  $("#liveRoomCodeInput").addEventListener("input",event=>{
    event.target.value=ONLINE.cleanRoomCode(event.target.value);
  });

  $("#liveJoinForm").onsubmit=async event=>{
    event.preventDefault();
    const input=$("#liveRoomCodeInput");
    const errorEl=$("#liveJoinError");
    const valid=ONLINE.validateRoomCode(input.value);
    if(!valid.ok){errorEl.textContent=valid.message;return;}
    errorEl.textContent="";
    try{
      const state=await ONLINE.joinPrivateMatch(valid.roomCode);
      openLiveMatch(state);
    }catch(error){
      errorEl.textContent=String(error?.message||"Odaya katılınamadı.");
    }
  };

}

function liveEffectiveStatus(state){
  if(!state)return "waiting";
  if(state.status!=="countdown")return state.status;
  const start=Date.parse(state.startedAt||"");
  return Number.isFinite(start) && liveServerNow()>=start ? "active" : "countdown";
}

function liveServerNow(){
  return Date.now()+(liveMatchSession?.serverOffset||0);
}

function formatLiveTime(ms){
  const total=Math.max(0,Math.floor(ms/1000));
  const min=Math.floor(total/60);
  const sec=total%60;
  return `${String(min).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

function liveElapsed(state,player=null){
  const start=Date.parse(state?.startedAt||"");
  if(!Number.isFinite(start))return 0;
  const stop=player?.solvedAt
    ? Date.parse(player.solvedAt)
    : state?.endedAt
      ? Date.parse(state.endedAt)
      : liveServerNow();
  return Math.max(0,stop-start);
}

function liveGuessesFor(state,playerId){
  return (Array.isArray(state?.guesses)?state.guesses:[])
    .filter(item=>String(item.playerId)===String(playerId))
    .sort((a,b)=>Number(a.guessNo)-Number(b.guessNo));
}

function liveCounterHTML(feedback,{playerRole="",row=-1}={}){
  const f=feedback||{};
  const attr=playerRole && row>=0
    ? kind=>` data-live-counter-player="${playerRole}" data-live-counter-row="${row}" data-live-counter-kind="${kind}"`
    : ()=>"";
  return `
    <div class="live-counters">
      <b class="green-box"${attr("green")}>${feedback?Number(f.green)||0:""}</b>
      <b class="yellow-box"${attr("yellow")}>${feedback?Number(f.yellow)||0:""}</b>
      <b class="red-box"${attr("red")}>${feedback?Number(f.red)||0:""}</b>
    </div>`;
}

function liveMarkState(row,col){
  return liveMatchSession?.marks?.[`${row}:${col}`]||"none";
}

function liveBoardHTML(state,player,{self=false}={}){
  if(!player)return `<div class="live-empty-opponent">Rakip bekleniyor…</div>`;
  const guesses=liveGuessesFor(state,player.id);
  const status=liveEffectiveStatus(state);
  const active=self && status==="active" && !player.solvedAt && Number(player.attemptsUsed)<Number(state.attemptLimit);
  const role=self?"self":"opponent";
  const invalidNow=self && Number(liveMatchSession?.invalidInputUntil||0)>Date.now();
  const rows=[];

  for(let r=0;r<Number(state.attemptLimit);r++){
    const guess=guesses.find(item=>Number(item.guessNo)===r+1) || null;
    const isInput=active && r===Number(player.attemptsUsed);
    const inputChars=isInput?[...(liveMatchSession?.input||"")]:[];
    const chars=guess?[...String(guess.guessWord||"")]:inputChars;
    const pattern=Array.isArray(guess?.feedback?.pattern)?guess.feedback.pattern:[];

    const tiles=Array.from({length:Number(state.wordLength)},(_,c)=>{
      const ch=chars[c]||"";
      const klass=["live-tile"];
      if(isInput && invalidNow)klass.push("invalid-word");
      if(state.mode==="classic" && guess && pattern[c])klass.push(`feedback-${pattern[c]}`);
      if(state.mode==="kelimelik" && self && guess){
        const mark=liveMarkState(r,c);
        if(mark!=="none")klass.push(`manual-${mark}`);
      }
      const markAttr=state.mode==="kelimelik" && self && guess
        ? ` data-live-mark-row="${r}" data-live-mark-col="${c}" role="button" tabindex="0"`
        : "";
      return `<span class="${klass.join(" ")}" data-live-player="${role}" data-live-row="${r}" data-live-col="${c}"${markAttr}>${escapeHTML(ch)}</span>`;
    }).join("");

    rows.push(`
      <div class="live-board-row ${isInput?"is-input":""}" data-live-row="${r}">
        <div class="live-tiles" style="--live-cols:${state.wordLength}">${tiles}</div>
        ${state.mode==="kelimelik"?liveCounterHTML(guess?.feedback||null,{playerRole:role,row:r}):""}
      </div>`);
  }

  return `<div class="live-board live-board-${state.mode}">${rows.join("")}</div>`;
}

function livePlayerSummary(state,player,{self=false}={}){
  if(!player)return `<div class="live-player-card waiting"><b>Rakip</b><span>Bağlantı bekleniyor…</span></div>`;
  const remaining=Math.max(0,Number(state.attemptLimit)-Number(player.attemptsUsed||0));
  const roleSuffix=self?" · Sen":" · Rakip";
  const nameLine=`<b>${escapeHTML(player.nickname||"Oyuncu")}${player.isBot?' <em class="bot-tag">BOT</em>':""}${roleSuffix}</b><small>${player.isBot?"Yapay rakip":"#"+escapeHTML(player.playerCode||"-----")}</small>`;
  const identity=!self && !player.isBot
    ? `<button class="live-player-identity" id="liveOpponentProfileBtn" type="button" aria-label="${escapeHTML(player.nickname||"Rakip")} profilini aç">${nameLine}</button>`
    : `<div>${nameLine}</div>`;
  return `
    <div class="live-player-card ${self?"self":"opponent"}">
      ${identity}
      <span>${Number(player.attemptsUsed)||0}/${state.attemptLimit} tahmin · ${remaining} kaldı</span>
    </div>`;
}

function liveKeyboardHTML(state){
  const guesses=state?.me?liveGuessesFor(state,state.me.id):[];
  const keyState=buildOnlineKeyboardState(state?.mode,guesses);
  return `<div class="live-keyboard">
    ${LIVE_KEYBOARD_ROWS.map((row,index)=>`
      <div class="live-key-row">
        ${row.map(ch=>`<button class="live-key${onlineKeyboardClass(keyState,ch)}" data-live-letter="${ch}">${ch}</button>`).join("")}
        ${index===2?'<button class="live-key live-key-action" data-live-action="backspace" aria-label="Son harfi sil">⌫</button>':""}
      </div>`).join("")}
    <div class="live-key-row live-submit-row">
      <button class="live-submit-btn" data-live-action="submit">Tahmini Gönder ✓</button>
    </div>
  </div>`;
}

function liveOpponentStatusText(state){
  const opp=state?.opponent;
  if(opp?.isBot)return "";
  let opponentText="";
  if(opp?.lastSeenAt){
    const staleMs=liveServerNow()-Date.parse(opp.lastSeenAt);
    if(staleMs>7000){
      const left=Math.max(0,20-Math.floor(staleMs/1000));
      opponentText=`Rakip bağlantısını kaybetti · ${left} sn`;
    }
  }
  return opponentText;
}

function liveCountdownPhase(state){
  const diff=Math.max(0,Date.parse(state?.startedAt||"")-liveServerNow());
  if(diff<=1000){
    return {label:"MAÇ BAŞLASIN!",go:true};
  }
  const count=Math.min(3,Math.max(1,Math.ceil((diff-1000)/1000)));
  return {label:String(count),go:false};
}

function liveStatusBanner(state){
  const status=liveEffectiveStatus(state);
  if(state.status==="waiting"){
    return `<div class="live-status waiting"><span class="live-pulse"></span><span class="live-status-text">Rakip bekleniyor…</span></div>`;
  }
  if(status==="countdown"){
    const phase=liveCountdownPhase(state);
    return `<div class="live-countdown ${phase.go?"is-go":""}"><small>${phase.go?"Başlıyor":"Hazır ol"}</small><b>${phase.label}</b></div>`;
  }
  if(status==="active"){
    const me=state?.me;
    const exhausted=Boolean(me && !me.solvedAt && Number(me.attemptsUsed)>=Number(state.attemptLimit));
    if(state?.opponent?.isBot && !exhausted)return "";
    let text=liveOpponentStatusText(state);
    if(exhausted){
      text=state?.opponent?.isBot
        ? `Tahmin hakkın bitti · ${state.opponent.nickname||"Bot"} tamamlıyor…`
        : "Tahmin hakkın bitti · Rakibin tamamlaması bekleniyor…";
    }
    if(!text)return "";
    return `<div class="live-status active"><span class="live-pulse"></span><span class="live-status-text">${escapeHTML(text)}</span></div>`;
  }
  return "";
}

function liveResultHTML(state){
  if(state.status!=="ended" && state.status!=="cancelled")return "";
  const me=state.me,opp=state.opponent;
  const cancelled=state.status==="cancelled";
  const draw=!cancelled && !state.winnerId;
  const iWon=String(state.winnerId||"")===String(me?.id||"");
  const title=cancelled
    ? "Maç sona erdi"
    : draw
      ? "Berabere 🤝"
      : iWon
        ? "Kazandın 🏆"
        : `${escapeHTML(opp?.nickname||"Rakip")} Kazandı 🏆`;
  const reason=state.endReason==="disconnect"?"Rakip bağlantısı kesildi.":state.endReason==="forfeit"?"Rakip maçtan çıktı.":"";
  const answer=String(state.answerWord||"").trim().toLocaleUpperCase("tr-TR");
  return `
    <section class="live-result-card live-result-screen">
      <h3>${title}</h3>
      ${reason?`<p>${escapeHTML(reason)}</p>`:""}
      ${answer?`<div class="live-result-answer"><small>Cevap</small><strong>${escapeHTML(answer)}</strong></div>`:'<div class="live-result-answer is-loading"><small>Cevap</small><strong>Yükleniyor…</strong></div>'}
      <div class="live-result-grid">
        <div><b>${escapeHTML(me?.nickname||"Sen")}</b><span>${me?.attemptsUsed||0}/${state.attemptLimit} · ${me?.solvedAt?formatLiveTime(liveElapsed(state,me)):"—"}</span></div>
        <div><b>${escapeHTML(opp?.nickname||"Rakip")}</b><span>${opp?.attemptsUsed||0}/${state.attemptLimit} · ${opp?.solvedAt?formatLiveTime(liveElapsed(state,opp)):"—"}</span></div>
      </div>
      <div class="live-result-actions">
        <button class="start-btn" id="liveRematchBtn">${state.matchKind==="bot"?"Botla Tekrar Oyna":state.rematchRequestedByOpponent?"Rövanşı Kabul Et":"Rövanş İste"}</button>
        <button class="modal-back-btn" id="liveShareResultBtn">Maçı Paylaş</button>
      </div>
      ${state.rematchRequestedByMe?'<small class="live-rematch-wait">Rövanş isteğin rakibe gönderildi…</small>':""}
    </section>`;
}

function liveRoomInviteHTML(state){
  if(state.status!=="waiting")return "";
  return `
    <section class="live-invite-card">
      <span>Oda Kodu</span>
      <strong>${escapeHTML(state.roomCode)}</strong>
      <p>Arkadaşına kodu veya davet bağlantısını gönder. İkinci oyuncu katılınca oyun 3 saniye sonra otomatik başlayacak.</p>
      <div class="live-invite-actions">
        <button class="start-btn" id="copyLiveLinkBtn">Davet Bağlantısını Kopyala</button>
        <button class="modal-back-btn" id="copyLiveCodeBtn">Kodu Kopyala</button>
      </div>
    </section>`;
}

function bindLiveMatchUI(){
  document.querySelectorAll("[data-live-letter]").forEach(btn=>btn.onclick=()=>liveAddLetter(btn.dataset.liveLetter));
  document.querySelector('[data-live-action="backspace"]')?.addEventListener("click",liveBackspace);
  document.querySelector('[data-live-action="clear"]')?.addEventListener("click",()=>{
    if(!liveMatchSession)return;
    liveMatchSession.marks={};
    renderLiveMatch();
  });
  document.querySelector('[data-live-action="submit"]')?.addEventListener("click",liveSubmitGuess);

  document.querySelectorAll("[data-live-mark-row]").forEach(tile=>{
    const cycle=()=>cycleLiveMark(Number(tile.dataset.liveMarkRow),Number(tile.dataset.liveMarkCol));
    tile.onclick=cycle;
    tile.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();cycle();}};
  });

  $("#copyLiveLinkBtn")?.addEventListener("click",async()=>{
    const url=liveRoomUrl(liveMatchSession.state.roomCode);
    try{await navigator.clipboard.writeText(url);showToast("Davet bağlantısı kopyalandı.");}
    catch(e){showToast("Bağlantı kopyalanamadı.");}
  });
  $("#copyLiveCodeBtn")?.addEventListener("click",async()=>{
    try{await navigator.clipboard.writeText(liveMatchSession.state.roomCode);showToast("Oda kodu kopyalandı.");}
    catch(e){showToast("Oda kodu kopyalanamadı.");}
  });

  document.querySelectorAll("[data-live-reaction]").forEach(btn=>{
    btn.onclick=async()=>{
      const session=liveMatchSession;
      if(!session)return;
      const now=Date.now();
      if(now<Number(session.reactionCooldownUntil||0))return;
      session.reactionCooldownUntil=now+1150;
      try{
        await ONLINE.sendLiveReaction(session.state.id,btn.dataset.liveReaction);
      }catch(error){
        const message=String(error?.message||"Tepki gönderilemedi.");
        if(!/Çok hızlı tepki|çok fazla istek|rate limit/i.test(message))showToast(message);
      }
    };
  });

  $("#liveOpponentProfileBtn")?.addEventListener("click",openLiveOpponentProfile);
  $("#liveRematchBtn")?.addEventListener("click",requestLiveRematch);
  $("#liveShareResultBtn")?.addEventListener("click",shareLiveResult);
}

function botNormalBoardHTML(state,player,{self=false}={}){
  if(!player)return "";
  const guesses=liveGuessesFor(state,player.id);
  const status=liveEffectiveStatus(state);
  const active=self && status==="active" && !player.solvedAt && Number(player.attemptsUsed)<Number(state.attemptLimit);
  const role=self?"self":"opponent";
  const invalidNow=self && Number(liveMatchSession?.invalidInputUntil||0)>Date.now();
  const parts=[];

  for(let r=0;r<Number(state.attemptLimit);r++){
    const guess=guesses.find(item=>Number(item.guessNo)===r+1) || null;
    const isInput=active && r===Number(player.attemptsUsed);
    const inputChars=isInput?[...(liveMatchSession?.input||"")]:[];
    const chars=guess?[...String(guess.guessWord||"")]:inputChars;
    const pattern=Array.isArray(guess?.feedback?.pattern)?guess.feedback.pattern:[];

    for(let c=0;c<Number(state.wordLength);c++){
      const ch=chars[c]||"";
      const classes=["tile","bot-game-tile"];
      if(isInput && invalidNow)classes.push("invalid-word");
      if(state.mode==="classic" && guess && pattern[c])classes.push(`state-${pattern[c]}`);
      if(state.mode==="kelimelik" && self && guess){
        const mark=liveMarkState(r,c);
        if(mark!=="none")classes.push(`state-${mark}`);
      }
      const markAttr=state.mode==="kelimelik" && self && guess
        ? ` data-live-mark-row="${r}" data-live-mark-col="${c}" role="button" tabindex="0"`
        : "";
      parts.push(`<button class="${classes.join(" ")}" data-live-player="${role}" data-live-row="${r}" data-live-col="${c}"${markAttr} aria-label="Satır ${r+1}, sütun ${c+1}${ch?`, ${escapeHTML(ch)}`:""}">${escapeHTML(ch)}</button>`);
    }

    if(state.mode==="kelimelik"){
      const f=guess?.feedback||null;
      parts.push(`<div class="counter counter-green" data-live-counter-player="${role}" data-live-counter-row="${r}" data-live-counter-kind="green">${f?Number(f.green)||0:""}</div>`);
      parts.push(`<div class="counter counter-yellow" data-live-counter-player="${role}" data-live-counter-row="${r}" data-live-counter-kind="yellow">${f?Number(f.yellow)||0:""}</div>`);
      parts.push(`<div class="counter counter-red" data-live-counter-player="${role}" data-live-counter-row="${r}" data-live-counter-kind="red">${f?Number(f.red)||0:""}</div>`);
    }
  }

  const columns=state.mode==="kelimelik"
    ? `repeat(${state.wordLength},var(--s)) repeat(3,var(--s))`
    : `repeat(${state.wordLength},var(--s))`;

  return `<div class="bot-game-area game-area"><div class="board bot-game-board ${state.mode==="classic"?"classic-direct-board":""}" style="grid-template-columns:${columns}">${parts.join("")}</div></div>`;
}

function botNormalKeyboardHTML(state){
  const guesses=state?.me?liveGuessesFor(state,state.me.id):[];
  const keyState=buildOnlineKeyboardState(state?.mode,guesses);
  return `<section class="keyboard-shell bot-keyboard-shell" aria-label="Oyun klavyesi"><div class="keyboard bot-normal-keyboard">
    ${LIVE_KEYBOARD_ROWS.map((row,index)=>`
      <div class="key-row">
        ${row.map(ch=>`<button class="key${onlineKeyboardClass(keyState,ch)}" data-live-letter="${ch}">${ch}</button>`).join("")}
        ${index===2?'<button class="key action" data-live-action="backspace" aria-label="Son harfi sil">⌫</button>':""}
      </div>`).join("")}
    <div class="key-row key-action-row bot-action-row">
      ${state.mode==="kelimelik"?'<button class="key action tooltip-btn" data-live-action="clear" data-tooltip="Tüm işaretlemeleri kaldır" aria-label="Tüm işaretlemeleri kaldır">◆</button>':""}
      <button class="key action tooltip-btn bot-submit-key" data-live-action="submit" data-tooltip="Tahmini gönder" aria-label="Tahmini gönder">✓</button>
    </div>
  </div></section>`;
}

function renderBotMatchNormal(state,root,{status,modeText,timer}){
  const me=state.me,opp=state.opponent;

  if(status==="countdown"){
    root.innerHTML=`
      <div class="live-match-shell bot-normal-shell is-countdown" id="liveMatchShell">
        <header class="live-match-head bot-normal-head">
          <div class="live-head-mode"><h2>${escapeHTML(modeText)}</h2></div>
        </header>
        ${liveStatusBanner(state)}
        <div class="live-reaction-pop" id="liveReactionPop" aria-live="polite"></div>
      </div>`;
    return;
  }

  if(state.status==="ended" || state.status==="cancelled"){
    root.innerHTML=`
      <div class="live-match-shell bot-normal-shell is-result" id="liveMatchShell">
        <header class="live-match-head bot-normal-head">
          <div class="live-head-mode"><h2>${escapeHTML(modeText)}</h2></div>
          <div class="live-match-time">${timer}</div>
        </header>
        ${liveResultHTML(state)}
        <div class="live-reaction-pop" id="liveReactionPop" aria-live="polite"></div>
      </div>`;
    return;
  }

  root.innerHTML=`
    <div class="live-match-shell bot-normal-shell" id="liveMatchShell">
      <header class="live-match-head bot-normal-head">
        <div class="live-head-mode"><h2>${escapeHTML(modeText)}</h2></div>
        <div class="live-match-time">${timer}</div>
      </header>
      ${status==="active"?liveStatusBanner(state):""}
      <div class="bot-dual-grid">
        <section class="bot-board-side bot-self-side">
          ${livePlayerSummary(state,me,{self:true})}
          ${botNormalBoardHTML(state,me,{self:true})}
        </section>
        <div class="bot-dual-vs">VS</div>
        <section class="bot-board-side bot-opponent-side">
          ${livePlayerSummary(state,opp)}
          ${botNormalBoardHTML(state,opp)}
        </section>
      </div>
      ${status==="active" && me && !me.solvedAt && Number(me.attemptsUsed)<Number(state.attemptLimit)
        ? botNormalKeyboardHTML(state)
        : ""}
      ${liveResultHTML(state)}
      <div class="live-reaction-pop" id="liveReactionPop" aria-live="polite"></div>
    </div>`;
}

function renderLiveMatch(){
  if(!liveMatchSession?.state)return;
  const state=liveMatchSession.state;
  const root=$("#liveMatchRoot");
  if(!root)return;
  liveMatchSession.renderSignature=liveRenderSignature(state);
  liveMatchSession.effectiveStatus=liveEffectiveStatus(state);
  const status=liveEffectiveStatus(state);
  const me=state.me,opp=state.opponent;
  const modeText=state.mode==="classic"?`Klasik · ${state.wordLength} Harf`:`Kelimelik · ${state.wordLength} Harf`;
  const matchLabel=state.matchKind==="quick"?"HIZLI EŞLEŞME":"CANLI MAÇ";
  const timer=status==="active"||state.status==="ended"
    ? formatLiveTime(liveElapsed(state))
    : "00:00";

  if(state.matchKind==="bot"){
    renderBotMatchNormal(state,root,{status,modeText,timer});
    bindLiveMatchUI();
    return;
  }

  if(status==="countdown"){
    root.innerHTML=`
      <div class="live-match-shell is-countdown" id="liveMatchShell">
        <header class="live-match-head">
          <div class="live-head-mode"><h2>${escapeHTML(modeText)}</h2></div>
        </header>
        ${liveStatusBanner(state)}
        <div class="live-reaction-pop" id="liveReactionPop" aria-live="polite"></div>
      </div>`;
    bindLiveMatchUI();
    return;
  }

  if(state.status==="ended" || state.status==="cancelled"){
    root.innerHTML=`
      <div class="live-match-shell is-result" id="liveMatchShell">
        <header class="live-match-head">
          <div class="live-head-mode"><h2>${escapeHTML(modeText)}</h2></div>
          <div class="live-match-time">${timer}</div>
        </header>
        ${liveResultHTML(state)}
        <div class="live-reaction-pop" id="liveReactionPop" aria-live="polite"></div>
      </div>`;
    bindLiveMatchUI();
    return;
  }

  root.innerHTML=`
    <div class="live-match-shell" id="liveMatchShell">
      <header class="live-match-head">
        <div class="live-head-mode"><h2>${escapeHTML(modeText)}</h2></div>
        ${status==="active"?`<div class="live-match-time">${timer}</div>`:""}
      </header>
      ${status==="active"?liveStatusBanner(state):""}
      ${liveRoomInviteHTML(state)}
      ${status!=="waiting"?`
        <div class="live-versus-grid">
          <section class="live-side self-side">
            ${livePlayerSummary(state,me,{self:true})}
            ${liveBoardHTML(state,me,{self:true})}
          </section>
          <div class="live-vs">VS</div>
          <section class="live-side opponent-side">
            ${livePlayerSummary(state,opp)}
            ${liveBoardHTML(state,opp)}
          </section>
        </div>`:""}
      ${status==="active" && me && !me.solvedAt && Number(me.attemptsUsed)<Number(state.attemptLimit)
        ? liveKeyboardHTML(state)
        : ""}
      ${status==="active"?`
        <div class="live-reactions" aria-label="Hızlı tepkiler">
          ${LIVE_REACTIONS.map(emoji=>`<button data-live-reaction="${emoji}">${emoji}</button>`).join("")}
        </div>`:""}
      ${liveResultHTML(state)}
      <div class="live-reaction-pop" id="liveReactionPop" aria-live="polite"></div>
    </div>`;

  bindLiveMatchUI();
  maybeClaimLiveDisconnect();
}

function liveTileElement(playerRole,row,col){
  return document.querySelector(
    `[data-live-player="${playerRole}"][data-live-row="${row}"][data-live-col="${col}"]`
  );
}

function animateLiveTileEntry(playerRole,row,col){
  if(!loadSettings().animations)return;
  const tile=liveTileElement(playerRole,row,col);
  if(!tile)return;
  tile.classList.remove("tile-pop");
  void tile.offsetWidth;
  tile.classList.add("tile-pop");
  setTimeout(()=>tile?.classList.remove("tile-pop"),260);
}

function animateLiveSubmittedRow(playerRole,row,state){
  if(!loadSettings().animations)return;
  const tiles=[...document.querySelectorAll(
    `[data-live-player="${playerRole}"][data-live-row="${row}"][data-live-col]`
  )];
  if(!tiles.length)return;

  tiles.forEach((tile,index)=>{
    tile.style.setProperty("--reveal-delay",`${index*65}ms`);
    tile.classList.remove("tile-submit");
    void tile.offsetWidth;
    tile.classList.add("tile-submit");
    setTimeout(()=>{
      tile?.classList.remove("tile-submit");
      tile?.style.removeProperty("--reveal-delay");
    },620+index*65);
  });

  if(state?.mode!=="kelimelik")return;
  const playerId=playerRole==="self"?state?.me?.id:state?.opponent?.id;
  const guess=liveGuessesFor(state,playerId).find(item=>Number(item.guessNo)===row+1);
  const feedback=guess?.feedback;
  if(!feedback)return;

  ["green","yellow","red"].forEach((kind,index)=>{
    const box=document.querySelector(
      `[data-live-counter-player="${playerRole}"][data-live-counter-row="${row}"][data-live-counter-kind="${kind}"]`
    );
    if(!box)return;
    const finalValue=Number(feedback[kind])||0;
    const delay=Number(state.wordLength)*65+index*95;
    box.textContent="0";
    box.classList.remove("counter-reveal");
    setTimeout(()=>{
      if(!box.isConnected)return;
      box.textContent=String(finalValue);
      box.classList.add("counter-reveal");
    },delay);
    setTimeout(()=>box?.classList.remove("counter-reveal"),delay+420);
  });
}

function liveNewGuessRows(previousState,nextState){
  const rows=[];
  [["self",nextState?.me?.id],["opponent",nextState?.opponent?.id]].forEach(([role,playerId])=>{
    if(!playerId)return;
    const before=new Set(
      liveGuessesFor(previousState,playerId).map(item=>Number(item.guessNo))
    );
    liveGuessesFor(nextState,playerId).forEach(item=>{
      const no=Number(item.guessNo);
      if(Number.isInteger(no) && no>0 && !before.has(no))rows.push({role,row:no-1});
    });
  });
  return rows;
}

function cycleLiveMark(row,col){
  if(!liveMatchSession)return;
  const key=`${row}:${col}`;
  const order=["none","red","yellow","green"];
  const current=liveMatchSession.marks[key]||"none";
  liveMatchSession.marks[key]=order[(order.indexOf(current)+1)%order.length];
  renderLiveMatch();
}

function liveCanType(){
  const state=liveMatchSession?.state;
  if(!state || liveEffectiveStatus(state)!=="active" || liveMatchSession.submitting)return false;
  const me=state.me;
  return Boolean(me && !me.solvedAt && Number(me.attemptsUsed)<Number(state.attemptLimit));
}

function liveAddLetter(letter){
  if(!liveCanType())return;
  const max=Number(liveMatchSession.state.wordLength);
  if(liveMatchSession.input.length>=max)return;
  const row=Number(liveMatchSession.state?.me?.attemptsUsed)||0;
  const col=[...liveMatchSession.input].length;
  liveMatchSession.input+=String(letter||"").toLocaleUpperCase("tr-TR");
  liveMatchSession.invalidInputUntil=0;
  renderLiveMatch();
  requestAnimationFrame(()=>animateLiveTileEntry("self",row,col));
}

function liveBackspace(){
  if(!liveCanType())return;
  liveMatchSession.invalidInputUntil=0;
  liveMatchSession.input=[...liveMatchSession.input].slice(0,-1).join("");
  renderLiveMatch();
}

function liveInvalidGuessMessage(message){
  const text=String(message||"");
  return /Kelime havuzunda yok|Geçersiz tahmin|Bu kelime geçerli değil/i.test(text);
}

function animateLiveInvalidGuess(){
  if(!liveMatchSession)return;
  liveMatchSession.invalidInputUntil=Date.now()+650;
  renderLiveMatch();
  setTimeout(()=>{
    if(!liveMatchSession)return;
    if(Number(liveMatchSession.invalidInputUntil||0)<=Date.now()){
      liveMatchSession.invalidInputUntil=0;
      renderLiveMatch();
    }
  },680);
}

async function liveSubmitGuess(){
  if(!liveCanType())return;
  const state=liveMatchSession.state;
  if([...liveMatchSession.input].length!==Number(state.wordLength)){
    showToast(`${state.wordLength} harf gir.`);
    return;
  }
  liveMatchSession.submitting=true;
  renderLiveMatch();
  try{
    const next=state.matchKind==="bot"
      ? await ONLINE.submitBotGuess(state.id,liveMatchSession.input)
      : await ONLINE.submitLiveGuess(state.id,liveMatchSession.input);
    liveMatchSession.input="";
    applyLiveState(next);
  }catch(error){
    const message=String(error?.message||"Tahmin gönderilemedi.");
    if(liveInvalidGuessMessage(message)){
      animateLiveInvalidGuess();
      announceGameStatus("Bu kelime geçerli değil. Tahmin hakkın kullanılmadı.");
    }else{
      showToast(message);
    }
  }finally{
    if(liveMatchSession){liveMatchSession.submitting=false;renderLiveMatch();}
  }
}

function handleLivePhysicalKey(e){
  if(!liveMatchSession || !$("#liveMatchShell"))return false;
  if(e.ctrlKey||e.metaKey||e.altKey)return false;
  if(e.key==="Backspace"){e.preventDefault();liveBackspace();return true;}
  if(e.key==="Enter"){e.preventDefault();liveSubmitGuess();return true;}
  if(typeof e.key==="string" && e.key.length===1){
    const letter=e.key.toLocaleUpperCase("tr-TR");
    if(PHYSICAL_KEY_LETTERS.has(letter)){e.preventDefault();liveAddLetter(letter);return true;}
  }
  return false;
}

function showLiveReaction(reaction){
  const pop=$("#liveReactionPop");
  if(!pop || !reaction)return;
  pop.textContent=String(reaction.emoji||"");
  pop.classList.remove("show");
  void pop.offsetWidth;
  pop.classList.add("show");
  setTimeout(()=>pop?.classList.remove("show"),1500);
}

function scheduleLiveRefresh(){
  clearTimeout(liveRefreshTimer);
  liveRefreshTimer=setTimeout(()=>refreshLiveMatch(),80);
}

async function refreshLiveMatch(){
  const id=liveMatchSession?.state?.id;
  if(!id)return;
  try{
    const state=liveMatchSession?.state?.matchKind==="bot"
      ? await ONLINE.advanceBotMatch(id)
      : await ONLINE.getLiveMatch(id);
    if(!liveMatchSession || liveMatchSession.state.id!==id)return;
    applyLiveState(state);
  }catch(error){
    console.warn("Canlı maç yenilenemedi:",error);
  }
}

function liveRenderSignature(state){
  if(!state)return "";
  const player=p=>p?{
    id:p.id,nickname:p.nickname,playerCode:p.playerCode,isBot:Boolean(p.isBot),botKey:p.botKey||null,
    attemptsUsed:Number(p.attemptsUsed)||0,solvedAt:p.solvedAt||null,joinedAt:p.joinedAt||null
  }:null;
  return JSON.stringify({
    id:state.id,matchKind:state.matchKind,roomCode:state.roomCode,mode:state.mode,
    wordLength:state.wordLength,attemptLimit:state.attemptLimit,status:state.status,
    startedAt:state.startedAt,endedAt:state.endedAt,winnerId:state.winnerId,endReason:state.endReason,
    answerWord:state.answerWord||null,
    rematchRequestedByMe:Boolean(state.rematchRequestedByMe),
    rematchRequestedByOpponent:Boolean(state.rematchRequestedByOpponent),
    rematchMatchId:state.rematchMatchId||null,parentMatchId:state.parentMatchId||null,
    me:player(state.me),opponent:player(state.opponent),guesses:Array.isArray(state.guesses)?state.guesses:[]
  });
}

function updateLiveClockUI(){
  const session=liveMatchSession;
  const state=session?.state;
  if(!session||!state||!$("#liveMatchShell"))return;

  const status=liveEffectiveStatus(state);
  if(session.effectiveStatus!==status){
    session.effectiveStatus=status;
    renderLiveMatch();
    return;
  }

  const timer=$("#liveMatchShell .live-match-time");
  if(timer && (status==="active" || state.status==="ended"))timer.textContent=formatLiveTime(liveElapsed(state));

  if(status==="countdown"){
    const countdown=$("#liveMatchShell .live-countdown");
    const counter=$("#liveMatchShell .live-countdown b");
    const caption=$("#liveMatchShell .live-countdown small");
    if(countdown && counter){
      const phase=liveCountdownPhase(state);
      countdown.classList.toggle("is-go",phase.go);
      counter.textContent=phase.label;
      if(caption)caption.textContent=phase.go?"Başlıyor":"Hazır ol";
    }
  }else if(status==="active"){
    const text=$("#liveMatchShell .live-status-text");
    if(text){
      const me=state?.me;
      const exhausted=Boolean(me && !me.solvedAt && Number(me.attemptsUsed)>=Number(state.attemptLimit));
      text.textContent=exhausted
        ? (state?.opponent?.isBot
            ? `Tahmin hakkın bitti · ${state.opponent.nickname||"Bot"} tamamlıyor…`
            : "Tahmin hakkın bitti · Rakibin tamamlaması bekleniyor…")
        : liveOpponentStatusText(state);
    }
    maybeClaimLiveDisconnect();
  }
}

function applyLiveState(state){
  if(!state || !liveMatchSession)return;
  const previousState=liveMatchSession.state;
  const newGuessRows=liveNewGuessRows(previousState,state);
  if(state.serverNow){
    const server=Date.parse(state.serverNow);
    if(Number.isFinite(server))liveMatchSession.serverOffset=server-Date.now();
  }
  const previousSignature=liveMatchSession.renderSignature||"";
  liveMatchSession.state=state;
  const nextSignature=liveRenderSignature(state);
  liveMatchSession.renderSignature=nextSignature;
  liveMatchSession.effectiveStatus=liveEffectiveStatus(state);
  if(state.matchKind==="private" && state.roomCode)updateLiveRoomUrl(state.roomCode);
  if(nextSignature!==previousSignature){
    renderLiveMatch();
    if(newGuessRows.length){
      requestAnimationFrame(()=>{
        newGuessRows.forEach(item=>animateLiveSubmittedRow(item.role,item.row,state));
      });
    }
  }else{
    updateLiveClockUI();
  }

  if(state.rematchMatchId && state.status==="ended"){
    switchToLiveRematch(state.rematchMatchId);
  }
}

async function switchToLiveRematch(matchId){
  if(!liveMatchSession || liveMatchSession.switchingRematch)return;
  liveMatchSession.switchingRematch=true;
  try{
    const state=await ONLINE.getLiveMatch(matchId);
    await openLiveMatch(state,{reuseModal:true});
  }catch(error){
    console.warn("Rövanş açılamadı:",error);
    liveMatchSession.switchingRematch=false;
  }
}

function stopLiveRuntime(){
  clearTimeout(liveRefreshTimer);
  liveRefreshTimer=null;
  if(!liveMatchSession)return;
  clearInterval(liveMatchSession.heartbeatTimer);
  clearInterval(liveMatchSession.clockTimer);
  clearInterval(liveMatchSession.pollTimer);
  try{liveMatchSession.unsubscribe?.();}catch(e){}
  liveMatchSession.unsubscribe=null;
}

async function startLiveRuntime(){
  const session=liveMatchSession;
  if(!session)return;
  const id=session.state.id;

  if(session.state.matchKind!=="bot"){
    try{
      session.unsubscribe=await ONLINE.subscribeLiveMatch(id,{
        onChange:scheduleLiveRefresh,
        onReaction:showLiveReaction,
        onStatus:status=>{
          session.realtimeStatus=status;
          if(status==="CHANNEL_ERROR"||status==="TIMED_OUT")showToast("Canlı bağlantı yeniden kuruluyor…");
        }
      });
    }catch(error){
      console.warn("Realtime kanalına bağlanılamadı:",error);
    }
  }

  session.heartbeatTimer=setInterval(async()=>{
    if(!liveMatchSession || liveMatchSession.state.id!==id)return;
    try{
      const next=session.state.matchKind==="bot"
        ? await ONLINE.advanceBotMatch(id)
        : await ONLINE.heartbeatLiveMatch(id);
      applyLiveState(next);
    }catch(error){console.warn("Canlı heartbeat başarısız:",error);}
  },session.state.matchKind==="bot"?1000:5000);

  session.pollTimer=setInterval(()=>{
    if(liveMatchSession?.state?.id===id)refreshLiveMatch();
  },session.state.matchKind==="bot"?1800:8000);

  session.effectiveStatus=liveEffectiveStatus(session.state);
  session.renderSignature=liveRenderSignature(session.state);
  session.clockTimer=setInterval(()=>{
    if(liveMatchSession?.state?.id===id)updateLiveClockUI();
  },250);
}

async function openLiveMatch(state,{reuseModal=false}={}){
  stopLiveRuntime();
  liveMatchSession={
    state,
    input:"",
    marks:{},
    submitting:false,
    claimingDisconnect:false,
    switchingRematch:false,
    invalidInputUntil:0,
    reactionCooldownUntil:0,
    serverOffset:state?.serverNow?Date.parse(state.serverNow)-Date.now():0,
    unsubscribe:null,
    heartbeatTimer:null,
    clockTimer:null,
    pollTimer:null,
    effectiveStatus:null,
    renderSignature:""
  };
  if(state?.matchKind==="private" && state?.roomCode)updateLiveRoomUrl(state.roomCode);
  else updateLiveRoomUrl("");

  if(!reuseModal || !$("#liveMatchRoot")){
    showModal('<div id="liveMatchRoot"></div>',{closeAction:handleLiveMatchClose,bodyClass:"live-match-modal-body"});
  }
  renderLiveMatch();
  await startLiveRuntime();
}

function handleLiveMatchClose(){
  const state=liveMatchSession?.state;
  if(!state){closeModal();return;}
  if(state.status==="ended"||state.status==="cancelled"){
    exitLiveMatch(false);
    return;
  }

  stopLiveRuntime();
  showModal(`
    <h2>Canlı Maçtan Çık?</h2>
    <p>${state.status==="waiting"?"Odayı kapatırsan davet kodu geçersiz olur.":"Tamamlanmamış maç iptal edilir; Son Oyunlar ve istatistiklere eklenmez."}</p>
    <div class="profile-actions">
      <button class="start-btn" id="returnLiveMatchBtn">Maça Dön</button>
      <button class="modal-back-btn danger-soft" id="leaveLiveMatchBtn">Maçtan Çık</button>
    </div>
  `,{closeAction:resumeLiveMatchModal});
  $("#returnLiveMatchBtn").onclick=resumeLiveMatchModal;
  $("#leaveLiveMatchBtn").onclick=()=>exitLiveMatch(true);
}

function resumeLiveMatchModal(){
  if(!liveMatchSession)return showMultiplayerMenu();
  showModal('<div id="liveMatchRoot"></div>',{closeAction:handleLiveMatchClose,bodyClass:"live-match-modal-body"});
  renderLiveMatch();
  startLiveRuntime();
}

async function exitLiveMatch(forfeit){
  const id=liveMatchSession?.state?.id;
  stopLiveRuntime();
  if(forfeit && id){
    try{
      if(liveMatchSession?.state?.matchKind==="bot")await ONLINE.leaveBotMatch(id);
      else await ONLINE.leaveLiveMatch(id);
    }catch(error){console.warn("Maçtan çıkış bildirilemedi:",error);}
  }
  liveMatchSession=null;
  updateLiveRoomUrl("");
  closeModal();
  showMultiplayerMenu();
}

async function maybeClaimLiveDisconnect(){
  const session=liveMatchSession;
  const state=session?.state;
  if(!session || !state || session.claimingDisconnect || liveEffectiveStatus(state)!=="active" || !state.opponent?.lastSeenAt)return;
  const stale=liveServerNow()-Date.parse(state.opponent.lastSeenAt);
  if(stale<20000)return;
  session.claimingDisconnect=true;
  try{applyLiveState(await ONLINE.claimDisconnectWin(state.id));}
  catch(error){console.warn("Disconnect sonucu alınamadı:",error);}
  finally{if(liveMatchSession)liveMatchSession.claimingDisconnect=false;}
}

async function requestLiveRematch(){
  if(!liveMatchSession?.state)return;
  const btn=$("#liveRematchBtn");
  if(btn){btn.disabled=true;btn.textContent="Gönderiliyor…";}
  try{
    if(liveMatchSession.state.matchKind==="bot"){
      const state=await ONLINE.createBotRematch(liveMatchSession.state.id);
      await openLiveMatch(state,{reuseModal:true});
    }else{
      const state=await ONLINE.requestLiveRematch(liveMatchSession.state.id);
      if(state.id!==liveMatchSession.state.id)await openLiveMatch(state,{reuseModal:true});
      else applyLiveState(state);
    }
  }catch(error){
    showToast(String(error?.message||"Rövanş isteği gönderilemedi."));
    renderLiveMatch();
  }
}

async function shareLiveResult(){
  const state=liveMatchSession?.state;
  if(!state)return;
  const me=state.me,opp=state.opponent;
  const cancelled=state.status==="cancelled";
  const draw=!cancelled && !state.winnerId;
  const iWon=String(state.winnerId||"")===String(me?.id||"");
  const result=cancelled?"Maç sona erdi":draw?"Berabere":iWon?`${me?.nickname||"Oyuncu"} kazandı`:`${opp?.nickname||"Rakip"} kazandı`;
  const text=`KELİMELİK\n\n${me?.nickname||"Oyuncu"} ⚔️ ${opp?.nickname||"Rakip"}\n${me?.attemptsUsed||0}/${state.attemptLimit} — ${opp?.attemptsUsed||0}/${state.attemptLimit}\n${cancelled?"⏹️":draw?"🤝":"🏆"} ${result}`;
  try{
    if(navigator.share){await navigator.share({title:"Kelimelik Canlı Maç",text});return;}
    await navigator.clipboard.writeText(text);
    showToast("Maç sonucu kopyalandı.");
  }catch(error){if(error?.name!=="AbortError")showToast("Paylaşım açılamadı.");}
}

async function joinLiveRoomByCode(roomCode){
  const profile=ONLINE?.getLocalProfile?.() || null;
  if(!profile){
    showProfileSetup({returnTo:()=>joinLiveRoomByCode(roomCode),backTo:showHome});
    return;
  }
  if(!ONLINE?.isConfigured?.()){
    showOnlineSetupRequired(showMultiplayerMenu);
    return;
  }

  showModal(`
    <div class="live-joining">
      <span class="meaning-spinner" aria-hidden="true"></span>
      <h2>Canlı Odaya Katılınıyor</h2>
      <p>Oda: <b>${escapeHTML(roomCode)}</b></p>
    </div>
  `,{closeAction:showHome});

  try{
    const state=await ONLINE.joinPrivateMatch(roomCode);
    openLiveMatch(state);
  }catch(error){
    showModal(`
      <h2>Odaya Katılınamadı</h2>
      <p>${escapeHTML(String(error?.message||"Canlı oda açılamadı."))}</p>
      <button class="start-btn" id="liveJoinRetryBtn">Tekrar Dene</button>
    `,{closeAction:showMultiplayerMenu});
    $("#liveJoinRetryBtn").onclick=()=>joinLiveRoomByCode(roomCode);
  }
}

function startLiveRoomFromUrl(){
  const code=liveRoomCodeFromUrl();
  if(!code)return false;
  setTimeout(()=>joinLiveRoomByCode(code),0);
  return true;
}



const BOT_PROFILES={
  efe:{name:"Efe",description:"En kolay seviyedir; daha sık hata yapar ve çoğu maçta çözümü daha geç bulur."},
  defne:{name:"Defne",description:"Dengeli hız ve dengeli çözüm performansı."},
  atlas:{name:"Atlas",description:"Daha yavaş düşünür; genelde daha güçlü tahminler yapar."}
};

function liveModePickerHTML(prefix,{bot=false}={}){
  return `
    <section class="live-setup-card ${bot?"bot-setup-card":""}">
      <div class="live-mode-toggle" role="group" aria-label="Oyun modu">
        <button class="live-mode-btn active" data-${prefix}-mode="kelimelik">◆ Kelimelik</button>
        <button class="live-mode-btn" data-${prefix}-mode="classic">▦ Klasik</button>
      </div>
      <div class="live-length-wrap" id="${prefix}LengthWrap">
        <span>Harf sayısı</span>
        <div class="live-length-toggle">
          <button class="active" data-${prefix}-length="4">4</button>
          <button data-${prefix}-length="5">5</button>
          <button data-${prefix}-length="6">6</button>
        </div>
      </div>
    </section>`;
}

function bindModePicker(prefix){
  let mode="kelimelik",length=4;
  const get=()=>({mode,length});
  document.querySelectorAll(`[data-${prefix}-mode]`).forEach(btn=>btn.onclick=()=>{
    mode=btn.dataset[`${prefix}Mode`];
    document.querySelectorAll(`[data-${prefix}-mode]`).forEach(x=>x.classList.toggle("active",x===btn));
    const wrap=$(`#${prefix}LengthWrap`);
    if(wrap)wrap.hidden=false;
  });
  document.querySelectorAll(`[data-${prefix}-length]`).forEach(btn=>btn.onclick=()=>{
    length=Number(btn.dataset[`${prefix}Length`]);
    document.querySelectorAll(`[data-${prefix}-length]`).forEach(x=>x.classList.toggle("active",x===btn));
  });
  return get;
}

function stopQuickMatchUI(){
  if(!quickMatchSession)return;
  clearInterval(quickMatchSession.pollTimer);
  clearInterval(quickMatchSession.clockTimer);
  quickMatchSession=null;
}

function renderQuickWaiting(){
  if(!quickMatchSession)return;
  const root=$("#quickWaitingRoot");
  if(!root)return;

  const elapsed=Math.max(0,Math.floor((Date.now()-quickMatchSession.startedAt)/1000));
  const botReady=elapsed>=12;

  /*
   * Kartı her sayaç tikinde yeniden üretmek spinner animasyonunu sürekli
   * baştan başlatıyordu. Kart bir kez çizilir; sonra yalnız süre ve bot alanı
   * güncellenir.
   */
  if(!root.querySelector(".quick-waiting-card")){
    root.innerHTML=`
      <div class="quick-waiting-card">
        <span class="quick-search-ring" role="status" aria-label="Rakip aranıyor"></span>
        <h2>Rakip Aranıyor</h2>
        <p>${quickMatchSession.mode==="classic"?`Klasik · ${quickMatchSession.length} Harf`:`Kelimelik · ${quickMatchSession.length} Harf`}</p>
        <small>Aynı modu seçen oyuncular arasından performansı sana en yakın rakip önceliklendiriliyor.</small>
        <div class="quick-bot-slot" id="quickBotSlot">
          <div class="quick-bot-hint">12 saniye içinde rakip bulunamazsa bot seçeneği açılır.</div>
        </div>
        <button class="modal-back-btn" id="quickCancelBtn">Eşleşmeyi İptal Et</button>
      </div>`;
    $("#quickCancelBtn").onclick=cancelQuickMatchAndMenu;
  }

  root.querySelector(".quick-search-ring")
    ?.setAttribute("aria-label","Rakip aranıyor");

  const botSlot=$("#quickBotSlot");
  if(botReady && botSlot && !$("#quickBotContinueBtn")){
    botSlot.innerHTML='<button class="start-btn" id="quickBotContinueBtn">🤖 Botla Devam Et</button>';
    $("#quickBotContinueBtn").addEventListener("click",continueQuickWithBot);
  }
}

async function cancelQuickMatchAndMenu(){
  const session=quickMatchSession;
  stopQuickMatchUI();
  try{
    const result=await ONLINE.cancelQuickMatch();
    if(result?.status==="matched" && result.match){openLiveMatch(result.match);return;}
  }catch(error){console.warn("Eşleşme iptal edilemedi:",error);}
  showMultiplayerMenu();
}

async function pollQuickMatchNow(){
  if(!quickMatchSession || quickMatchSession.polling)return;
  quickMatchSession.polling=true;
  try{
    const result=await ONLINE.pollQuickMatch();
    if(!quickMatchSession)return;
    if(result?.status==="matched" && result.match){
      stopQuickMatchUI();
      await openLiveMatch(result.match);
    }
  }catch(error){
    console.warn("Hızlı eşleşme sorgusu başarısız:",error);
  }finally{if(quickMatchSession)quickMatchSession.polling=false;}
}

async function startQuickMatch(mode,length){
  showModal('<div id="quickWaitingRoot"></div>',{closeAction:cancelQuickMatchAndMenu});
  quickMatchSession={mode,length,startedAt:Date.now(),polling:false,pollTimer:null,clockTimer:null};
  renderQuickWaiting();
  try{
    const result=await ONLINE.enterQuickMatch(mode,length);
    if(!quickMatchSession)return;
    if(result?.status==="matched" && result.match){stopQuickMatchUI();await openLiveMatch(result.match);return;}
    quickMatchSession.pollTimer=setInterval(pollQuickMatchNow,1800);
    quickMatchSession.clockTimer=setInterval(renderQuickWaiting,500);
  }catch(error){
    stopQuickMatchUI();
    showModal(
      `<h2>Eşleşme Başlatılamadı</h2><p>${escapeHTML(String(error?.message||"Hızlı eşleşme açılamadı."))}</p>`,
      {closeAction:showMultiplayerMenu}
    );
  }
}

async function continueQuickWithBot(){
  if(!quickMatchSession)return;
  const {mode,length}=quickMatchSession;
  const btn=$("#quickBotContinueBtn");
  if(btn){btn.disabled=true;btn.textContent="Kontrol ediliyor…";}
  try{
    const result=await ONLINE.cancelQuickMatch();
    if(result?.status==="matched" && result.match){stopQuickMatchUI();await openLiveMatch(result.match);return;}
    stopQuickMatchUI();
    const state=await ONLINE.createBotMatch(mode,length,null);
    await openLiveMatch(state);
  }catch(error){
    showToast(String(error?.message||"Bot maçı başlatılamadı."));
    stopQuickMatchUI();
    showQuickMatchSetup();
  }
}

function showQuickMatchSetup(){
  if(!ONLINE?.isConfigured?.()){showOnlineSetupRequired(showMultiplayerMenu);return;}
  showModal(`
    <h2>⚔️ Hızlı Eşleşme</h2>
    <p>Modunu seç. Sistem aynı moddaki çevrimiçi oyuncular arasından performansı en yakın rakibi bulmaya çalışır.</p>
    ${liveModePickerHTML("quick")}
    <button class="start-btn" id="startQuickMatchBtn">Rakip Ara</button>
  `,{closeAction:showMultiplayerMenu});
  const getMode=bindModePicker("quick");
  $("#startQuickMatchBtn").onclick=()=>{const pick=getMode();startQuickMatch(pick.mode,pick.length);};
}

function botCardsHTML(){
  return `<div class="bot-card-grid">${Object.entries(BOT_PROFILES).map(([key,bot])=>`
    <button class="bot-choice ${key==="defne"?"active":""}" data-bot-key="${key}">
      <b>${bot.name} <em>BOT</em></b><small>${bot.description}</small>
    </button>`).join("")}</div>`;
}

function showBotMatchSetup(){
  if(!ONLINE?.isConfigured?.()){showOnlineSetupRequired(showMultiplayerMenu);return;}
  showModal(`
    <h2>🤖 Bot Rakip</h2>
    <p>Rakibini ve modu seç. Botlar aynı hızda oynamaz; her maçta çözme tahminleri de değişir.</p>
    ${botCardsHTML()}
    ${liveModePickerHTML("bot",{bot:true})}
    <button class="start-btn" id="startBotMatchBtn">Botla Oyna</button>
  `,{closeAction:showMultiplayerMenu});
  let selectedBot="defne";
  document.querySelectorAll("[data-bot-key]").forEach(btn=>btn.onclick=()=>{
    selectedBot=btn.dataset.botKey;
    document.querySelectorAll("[data-bot-key]").forEach(x=>x.classList.toggle("active",x===btn));
  });
  const getMode=bindModePicker("bot");
  $("#startBotMatchBtn").onclick=async()=>{
    const btn=$("#startBotMatchBtn"),pick=getMode();
    btn.disabled=true;btn.textContent="Maç hazırlanıyor…";
    try{await openLiveMatch(await ONLINE.createBotMatch(pick.mode,pick.length,selectedBot));}
    catch(error){showToast(String(error?.message||"Bot maçı başlatılamadı."));btn.disabled=false;btn.textContent="Botla Oyna";}
  };
}

function showMultiplayerMenu(){
  const profile=ONLINE?.getLocalProfile?.() || null;
  if(!profile){
    showProfileSetup({returnTo:showMultiplayerMenu,backTo:showNewGameSelector});
    return;
  }

  const onlineReady=Boolean(ONLINE?.isConfigured?.());
  showModal(`
    <h2>Çok Oyunculu</h2>
    <div class="multiplayer-profile-strip">
      <div><strong>${escapeHTML(profile.nickname)}</strong><small>#${escapeHTML(profile.playerCode)}</small></div>
      <button class="profile-mini-btn" id="multiplayerProfileBtn">Profil</button>
    </div>
    <p>${onlineReady?"Arkadaşınla oyna, hızlı eşleşmeye gir veya bot rakip seç.":"Arkadaşınla canlı oyun, hızlı eşleşme ve bot seçenekleri burada yer alır."}</p>
    <div class="menu-list">
      <button class="menu-action" id="friendLiveGameBtn">
        <b>👥 Arkadaşınla Oyna</b>
        <small>Özel oda oluştur. Davet bağlantısını gönder. Arkadaşınla aynı bulmaca üzerinde yarış</small>
      </button>
      <button class="menu-action" id="quickMatchBtn">
        <b>⚔️ Hızlı Eşleşme</b>
        <small>Aynı moddaki çevrimiçi oyuncularla yarış</small>
      </button>
      <button class="menu-action" id="botMatchBtn">
        <b>🤖 Bot Rakip</b>
        <small>İnsan temposuna sahip botlarla yarış</small>
      </button>
    </div>
  `,{closeAction:showNewGameSelector});

  $("#multiplayerProfileBtn").onclick=showProfileModal;
  $("#friendLiveGameBtn").onclick=onlineReady?showFriendLiveSetup:()=>showOnlineSetupRequired(showMultiplayerMenu);
  $("#quickMatchBtn").onclick=onlineReady?showQuickMatchSetup:()=>showOnlineSetupRequired(showMultiplayerMenu);
  $("#botMatchBtn").onclick=onlineReady?showBotMatchSetup:()=>showOnlineSetupRequired(showMultiplayerMenu);
}

function showNewGameSelector(){
  showModal(`
    <h2>Yeni Oyun</h2>
    <p>Oyun modunu seç.</p>

    <div class="menu-list">
      <button class="menu-action" id="selectDailyGame">
        <b>📅 Günlük Bulmaca</b>
        <small>Her gün yeni 5 harfli bulmaca. Günde 1 kez oynanabilir.</small>
      </button>

      <button class="menu-action" id="selectClassicGame">
        <b>◆ Kelimelik Modu</b>
        <small>4, 5 veya 6 harf seç. 8 tahminde sayaçları kullanarak kelimeyi bul.</small>
      </button>

      <button class="menu-action" id="selectDirectClassicGame">
        <b>▦ Klasik Mod</b>
        <small>4, 5 veya 6 harf seç. Harf sayısına göre 5, 6 veya 7 tahminde çöz.</small>
      </button>

      <button class="menu-action" id="selectMultiplayerGame">
        <b>👥 Çok Oyunculu</b>
        <small>Profilini oluştur; canlı oda ve eşleşme sistemine gir.</small>
      </button>
    </div>
  `);

  $("#selectDailyGame").onclick=()=>{
    closeModal();
    if(newGame("daily",5)){
      showGame();
    }
  };

  $("#selectClassicGame").onclick=()=>{
    showClassicLengthSelector();
  };

  $("#selectDirectClassicGame").onclick=()=>{
    showDirectClassicLengthSelector();
  };

  $("#selectMultiplayerGame").onclick=showMultiplayerMenu;
}

function showPrivacyPolicy(){
  showModal(`
    <div class="privacy-policy">
      <h2>Privacy Policy</h2>

      <p>Bu gizlilik politikası, Kelimelik'in mevcut web sürümünün hangi verileri kullandığını açıklar.</p>

      <h3>Kişisel Veriler</h3>
      <p>Tek oyunculu Kelimelik hesap gerektirmez. Online özellikleri kullanmak istersen bir <b>takma ad</b> ve sistem tarafından üretilen <b>oyuncu kodu</b> kullanılır. İlk online sürümde e-posta zorunlu değildir.</p>

      <h3>Tarayıcıda Saklanan Veriler</h3>
      <p>Aktif oyun ve paylaşılan bulmaca ilerlemesi, istatistikler, animasyon ayarı, favori kelimeler ve son oyun geçmişi tarayıcının <b>localStorage</b> alanında cihazında saklanabilir.</p>
      <p>Tek oyunculu oyun kayıtları cihazında kalır. Online servis yapılandırıldığında takma ad, oyuncu kodu, multiplayer istatistikleri, canlı maçtaki gönderilmiş tahminler, hızlı tepkiler ve özel bulmaca oynama kayıtları oyun hizmetini sağlayan backend'e gönderilir. Canlı maç ve kullanıcı tarafından oluşturulan özel bulmaca cevapları backend'de tutulur; davet URL'lerine yazılmaz. Tarayıcı/site verilerini temizlemek yerel kayıtları silebilir.</p>

      <h3>Harici Hizmetler</h3>
      <p>Online özellikler etkinleştirildiğinde profil, anonim oturum, canlı maç, özel bulmaca ve multiplayer istatistik işlemleri için <b>Supabase</b> Auth/Database/Realtime hizmetlerine ağ istekleri gönderilir. İlk online sürüm e-posta veya şifre istemez.</p>
      <p><b>Anlamı</b> özelliğini kullandığında sorgulanan kelime için TDK Güncel Türkçe Sözlük hizmetine ağ isteği gönderilir. Uygulama içi sorgu başarısız olursa TDK sayfasını yeni sekmede açan bir bağlantı gösterilir. Kelime bildirimi ve feedback seçenekleri cihazındaki e-posta uygulamasını açabilir. Ana sayfadaki geliştirici profili bağlantısı yalnızca tıklandığında LinkedIn’e yönlendirir.</p>

      <h3>Çerezler, Analitik ve Reklam</h3>
      <p>Mevcut sürüm Google Analytics, reklam ağı veya benzeri üçüncü taraf takip aracı kullanmaz.</p>

      <h3>Hosting Sağlayıcısı</h3>
      <p>Site internette yayınlandığında hosting sağlayıcısı güvenlik ve hizmet işletimi amacıyla standart teknik erişim kayıtları tutabilir.</p>

      <h3>Değişiklikler</h3>
      <p>Yeni veri kullanan özellikler eklendiğinde bu politika güncellenebilir.</p>

      <button class="start-btn" id="privacyBackBtn">← Ana Sayfaya Dön</button>
    </div>
  `);

  $("#privacyBackBtn").onclick=()=>{
    closeModal();
    showHome();
  };
}

function showHome(){
  clearPendingResultReveal();
  document.documentElement.classList.remove("game-view");
  document.body.classList.remove("game-view");
  $("#gameScreen").hidden=true;
  $("#homeScreen").hidden=false;
  startHomeWordAnimation();
}
function showGame(){
  stopHomeWordAnimation();
  document.documentElement.classList.add("game-view");
  document.body.classList.add("game-view");
  $("#homeScreen").hidden=true;
  $("#gameScreen").hidden=false;
  updateGameModeStrip();
  if(!gameFinished && !gameTimerInterval){
    startGameTimer();
  }
}

$("#startGameBtn").onclick=()=>{
  showNewGameSelector();
};
$("#homeHowBtn").onclick=showHowTo;
$("#privacyBtn").onclick=showPrivacyPolicy;


/* Üst menüler */
$("#gameHowBtn").onclick=showHowTo;
$("#gameShareBtn").onclick=showShareMenu;
$("#profileBtn").onclick=showProfileModal;

$("#modeBtn").onclick=e=>{
  e.stopPropagation();
  showNewGameSelector();
};




function statsLabelForTab(tab){
  return {
    overall:"Genel",
    daily:"Günlük",
    classic4:"Kelimelik 4",
    classic5:"Kelimelik 5",
    classic6:"Kelimelik 6",
    classicMode:"Klasik",
    kelimelik:"Kelimelik",
    multiplayer:"Çok Oyunculu"
  }[tab] || "Genel";
}

function resolveStatsTab(category,length="4"){
  if(category==="kelimelik")return `classic${length}`;
  if(category==="classicMode")return "classicMode";
  if(category==="daily")return "daily";
  return "overall";
}

function getStatsBucket(stats,tab){
  if(tab==="daily")return stats.daily;
  if(tab==="classic4")return stats.classic["4"];
  if(tab==="classic5")return stats.classic["5"];
  if(tab==="classic6")return stats.classic["6"];
  if(tab==="classicMode")return stats.classicMode;
  return stats.overall;
}

function statsPanelHTML(bucket,tab){
  const winRate=bucket.gamesPlayed
    ? Math.round((bucket.wins/bucket.gamesPlayed)*100)
    : 0;

  const maxGuess=Math.max(1,...bucket.guessDistribution);
  const hasDetail=bucket.hasDetailedGuessData!==false;
  const avgGuesses=bucket.wins && hasDetail
    ? ((Number(bucket.totalWinningGuesses)||0)/bucket.wins).toFixed(1)
    : "—";
  const bestWin=bucket.bestWin ?? "—";

  let extra="";
  if(tab==="daily"){
    const daily=getTodayDailySummary();

    const dailyText=daily.won
      ? "Günün Bulmacası Çözüldü"
      : "Günün Bulmacası Çözülmedi";

    const detail=daily.completed
      ? `
        <div class="daily-status-detail">
          ${escapeHTML(daily.word)} ${daily.won && daily.tries ? `${daily.tries}/8` : "X/8"}
        </div>
      `
      : "";

    extra=`
      <div class="daily-status" aria-label="${dailyText}, ${formatDateTR(todayKey())}">
        <div class="daily-status-head">
          <span class="daily-status-text">${dailyText}</span>
          <time datetime="${todayKey()}">${formatDateTR(todayKey())}</time>
        </div>
        ${detail}
      </div>
    `;
  }

  return `
    <div class="stats-grid stats-grid-detailed">
      <div class="stat-card"><b>${bucket.gamesPlayed}</b><span>Oynanan oyun</span></div>
      <div class="stat-card"><b>%${winRate}</b><span>Kazanma oranı</span></div>
      <div class="stat-card"><b>${bucket.currentStreak}</b><span>Mevcut seri</span></div>
      <div class="stat-card"><b>${bucket.maxStreak}</b><span>En uzun seri</span></div>
      <div class="stat-card"><b>${avgGuesses}</b><span>Ort. tahmin</span></div>
      <div class="stat-card"><b>${bestWin}</b><span>En iyi sonuç</span></div>
    </div>

    ${extra}

    <h3>Tahmin Dağılımı</h3>
    <div class="guess-distribution">
      ${(tab==="classicMode"
        ? bucket.guessDistribution.slice(0,7)
        : bucket.guessDistribution
      ).map((value,index)=>{
        const width=value ? Math.max(8,Math.round((value/maxGuess)*100)) : 0;

        return `
          <div class="guess-dist-row">
            <span>${index+1}</span>
            <div class="guess-dist-track">
              <div class="guess-dist-fill" data-width="${width}"></div>
            </div>
            <span class="guess-dist-value">${value}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function multiplayerStatsPanelHTML(bucket,mode="overall"){
  const winRate=bucket.matches?Math.round((bucket.wins/bucket.matches)*100):0;
  const avgGuesses=bucket.solvedMatches
    ? (bucket.totalSolveGuesses/bucket.solvedMatches).toFixed(1)
    : "—";
  const avgSeconds=bucket.solvedMatches
    ? Math.round((bucket.totalSolveMs/bucket.solvedMatches)/1000)
    : null;
  const avgTime=avgSeconds===null?"—":`${Math.floor(avgSeconds/60)}:${String(avgSeconds%60).padStart(2,"0")}`;
  const modeLabel={overall:"Genel",kelimelik:"Kelimelik",classic:"Klasik"}[mode]||"Genel";

  return `
    <div class="multiplayer-stats-note"><b>${modeLabel}</b> online maç istatistikleri. Canlı maç sonuçların çevrimiçi profiline kaydedilir.</div>
    <div class="stats-grid stats-grid-detailed">
      <div class="stat-card"><b>${bucket.matches}</b><span>Oynanan maç</span></div>
      <div class="stat-card"><b>${bucket.wins}</b><span>Galibiyet</span></div>
      <div class="stat-card"><b>${bucket.losses}</b><span>Mağlubiyet</span></div>
      <div class="stat-card"><b>${bucket.draws}</b><span>Beraberlik</span></div>
      <div class="stat-card"><b>%${winRate}</b><span>Kazanma oranı</span></div>
      <div class="stat-card"><b>${bucket.currentStreak}</b><span>Mevcut seri</span></div>
      <div class="stat-card"><b>${bucket.maxStreak}</b><span>En uzun seri</span></div>
      <div class="stat-card"><b>${avgGuesses}</b><span>Ort. çözme tahmini</span></div>
      <div class="stat-card"><b>${avgTime}</b><span>Ort. çözme süresi</span></div>
    </div>
  `;
}

function applyStatsBarWidths(){
  document.querySelectorAll(".guess-dist-fill[data-width]").forEach(el=>{
    el.style.width=`${Number(el.dataset.width)||0}%`;
  });
}


function resetStatsOnly(currentTab="overall"){
  if(!confirm("İstatistikler sıfırlansın mı ? Günlük bulmaca hakkın değişmez."))return;
  storageRemove(STATS_KEY);
  storageRemove(LEGACY_STATS_KEY);
  saveStats(defaultStats());
  flashMessage("İstatistikler sıfırlandı.");
  renderStatsTab(currentTab);
}

function renderStatsTab(tab,category="overall",kelimelikLength="4"){
  if(tab==="daily")repairTodayDailyState();
  const stats=loadStats();
  const panel=$("#statsPanel");
  if(!panel)return;

  panel.innerHTML=statsPanelHTML(getStatsBucket(stats,tab),tab);
  document.querySelectorAll(".stats-tab").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.statsCategory===category);
  });
  document.querySelectorAll(".stats-subtab").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.statsLength===kelimelikLength);
  });
  const subTabs=$("#statsSubTabs");
  if(subTabs)subTabs.classList.toggle("visible",category==="kelimelik");
  applyStatsBarWidths();
}


function openStatsModal(initialCategory="overall"){
  showModal(`
    <h2>İstatistikler</h2>

    <div class="stats-tabs stats-tabs-online" role="tablist" aria-label="İstatistik modu">
      <button class="stats-tab active" data-stats-category="overall">Genel</button>
      <button class="stats-tab" data-stats-category="daily">Günlük</button>
      <button class="stats-tab" data-stats-category="kelimelik">Kelimelik</button>
      <button class="stats-tab" data-stats-category="classicMode" data-stats-tab="classicMode">Klasik</button>
      <button class="stats-tab" data-stats-category="multiplayer">Online</button>
    </div>

    <div class="stats-subtabs" id="statsSubTabs" aria-label="Kelimelik harf sayısı">
      <span>Harf sayısı</span>
      <div class="stats-subtabs-track" role="tablist" aria-label="Kelimelik harf sayısı">
        <button class="stats-subtab active" data-stats-length="4">4</button>
        <button class="stats-subtab" data-stats-length="5">5</button>
        <button class="stats-subtab" data-stats-length="6">6</button>
      </div>
    </div>

    <div class="stats-subtabs" id="multiplayerStatsSubTabs" aria-label="Çok oyunculu modu">
      <span>Mod</span>
      <div class="stats-subtabs-track multiplayer-stats-subtabs" role="tablist" aria-label="Çok oyunculu modu">
        <button class="stats-subtab multiplayer-subtab active" data-multiplayer-mode="overall">Genel</button>
        <button class="stats-subtab multiplayer-subtab" data-multiplayer-mode="kelimelik">Kelimelik</button>
        <button class="stats-subtab multiplayer-subtab" data-multiplayer-mode="classic">Klasik</button>
      </div>
    </div>

    <div id="statsPanel"></div>
    <div class="stats-actions" id="statsActions">
      <button class="stats-reset-btn" id="resetStatsBtn">İstatistikleri Sıfırla</button>
    </div>
  `,{bodyClass:"stats-modal-body"});

  let currentCategory=["overall","daily","kelimelik","classicMode","multiplayer"].includes(initialCategory)
    ? initialCategory
    : "overall";
  let currentKelimelikLength="4";
  let currentMultiplayerMode="overall";

  const syncStatsView=()=>{
    const panel=$("#statsPanel");
    if(!panel)return "overall";

    if(currentCategory==="multiplayer"){
      const stats=loadMultiplayerStats();
      panel.innerHTML=multiplayerStatsPanelHTML(stats[currentMultiplayerMode]||emptyMultiplayerStatBucket(),currentMultiplayerMode);
      document.querySelectorAll(".stats-tab").forEach(btn=>{
        btn.classList.toggle("active",btn.dataset.statsCategory===currentCategory);
      });
      document.querySelectorAll(".multiplayer-subtab").forEach(btn=>{
        btn.classList.toggle("active",btn.dataset.multiplayerMode===currentMultiplayerMode);
      });
      $("#statsSubTabs")?.classList.remove("visible");
      $("#multiplayerStatsSubTabs")?.classList.add("visible");
      const actions=$("#statsActions");
      if(actions)actions.hidden=true;
      refreshOwnOnlineStats().then(remoteStats=>{
        if(currentCategory!=="multiplayer")return;
        const current=remoteStats[currentMultiplayerMode]||emptyMultiplayerStatBucket();
        if(panel)panel.innerHTML=multiplayerStatsPanelHTML(current,currentMultiplayerMode);
      });
      return "multiplayer";
    }

    const currentTab=resolveStatsTab(currentCategory,currentKelimelikLength);
    renderStatsTab(currentTab,currentCategory,currentKelimelikLength);
    $("#multiplayerStatsSubTabs")?.classList.remove("visible");
    const actions=$("#statsActions");
    if(actions)actions.hidden=false;
    return currentTab;
  };

  document.querySelectorAll(".stats-tab").forEach(btn=>{
    btn.onclick=()=>{
      currentCategory=btn.dataset.statsCategory;
      syncStatsView();
    };
  });

  document.querySelectorAll("#statsSubTabs .stats-subtab").forEach(btn=>{
    btn.onclick=()=>{
      currentKelimelikLength=btn.dataset.statsLength || "4";
      currentCategory="kelimelik";
      syncStatsView();
    };
  });

  document.querySelectorAll(".multiplayer-subtab").forEach(btn=>{
    btn.onclick=()=>{
      currentMultiplayerMode=btn.dataset.multiplayerMode || "overall";
      currentCategory="multiplayer";
      syncStatsView();
    };
  });

  $("#resetStatsBtn").onclick=()=>resetStatsOnly(resolveStatsTab(currentCategory,currentKelimelikLength));
  syncStatsView();
}


window.addEventListener("resize",updateResponsiveBoardSize);

const modalCloseButton=$("#modalClose");
if(modalCloseButton){
  modalCloseButton.onclick=e=>{
    e?.preventDefault?.();
    e?.stopPropagation?.();
    closeOrBackModal();
  };
}
const liveModalCloseButton=$("#liveModalClose");
if(liveModalCloseButton){
  liveModalCloseButton.onclick=e=>{
    e?.preventDefault?.();
    e?.stopPropagation?.();
    closeOrBackModal();
  };
}
modalBackdrop.onclick=e=>{if(e.target===modalBackdrop)closeOrBackModal()};
$("#brandHome").onclick=e=>{
  e.preventDefault();
  showHome();
};

const PHYSICAL_KEY_LETTERS=new Set([
  ..."ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZQWX"
]);

function handlePhysicalGameKey(e){
  if(!modalBackdrop.hidden){
    if(e.key==="Escape"){
      e.preventDefault();
      closeOrBackModal();
      return;
    }

    if(handleCustomPuzzlePhysicalKey(e))return;
    if(handleLivePhysicalKey(e))return;

    if(e.key==="Tab"){
      const focusable=[...document.querySelectorAll(
        ".modal button:not([disabled]),.modal a[href],.modal input:not([disabled]),.modal select:not([disabled]),.modal textarea:not([disabled])"
      )].filter(el=>!el.hidden);

      if(focusable.length){
        const first=focusable[0];
        const last=focusable[focusable.length-1];
        if(e.shiftKey && document.activeElement===first){
          e.preventDefault();
          last.focus();
        }else if(!e.shiftKey && document.activeElement===last){
          e.preventDefault();
          first.focus();
        }
      }
    }
    return;
  }

  if($("#gameScreen").hidden || gameFinished)return;
  if(e.ctrlKey || e.metaKey || e.altKey)return;

  const tag=String(e.target?.tagName||"").toUpperCase();
  if(tag==="INPUT" || tag==="TEXTAREA" || tag==="SELECT" || tag==="BUTTON" || tag==="A")return;

  if(e.key==="Backspace"){
    e.preventDefault();
    backspace();
    return;
  }

  if(e.key==="Enter"){
    e.preventDefault();
    submitGuess();
    return;
  }

  if(typeof e.key==="string" && e.key.length===1){
    const letter=e.key.toLocaleUpperCase("tr-TR");
    if(PHYSICAL_KEY_LETTERS.has(letter)){
      e.preventDefault();
      addLetter(letter);
    }
  }
}

document.addEventListener("keydown",handlePhysicalGameKey);


/* Ana sayfadaki örnek satır animasyonu:
   5 harf + 3 sayaç tek bir animasyon grubu olarak hareket eder. */
const HOME_DEMOS=[
  {word:"KALEM",counts:[2,1,2]},
  {word:"BULUT",counts:[1,2,2]},
  {word:"DENİZ",counts:[3,1,1]},
  {word:"KİTAP",counts:[1,3,1]},
  {word:"GÜNEŞ",counts:[2,2,1]}
];

const HOME_GLYPHS="ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ";
const HOME_DIGITS="0123456789".split("");
const HOME_LETTERS=HOME_GLYPHS.split("");

const HOME_STEP=95;
const HOME_SCRAMBLE=320;
const HOME_COUNT_SCRAMBLE=240;
const HOME_GROUP_TICK=90;
const HOME_GROUP_FLASHES=3;
const HOME_HOLD=850;

let homeDemoIndex=0;
let homeCycleRun=0;
let homeTimers=[];
let homeScrambleHandles=[];

function homeLater(fn,ms){
  const id=setTimeout(fn,ms);
  homeTimers.push(id);
  return id;
}

function clearHomeTimers(){
  homeTimers.forEach(clearTimeout);
  homeTimers=[];
}

function clearHomeScrambles(){
  homeScrambleHandles.forEach(clearInterval);
  homeScrambleHandles=[];
}

function randomHomeItem(pool){
  return pool[Math.floor(Math.random()*pool.length)];
}

function ensureHomeMatrixRain(){
  const ambient=$("#homeAmbient");
  if(!ambient || ambient.querySelector(".rain-col"))return;

  for(let c=0;c<5;c++){
    const col=document.createElement("div");
    col.className="rain-col";
    col.style.left=`${8+c*21}%`;

    let text="";
    for(let i=0;i<40;i++){
      text+=HOME_GLYPHS[Math.floor(Math.random()*HOME_GLYPHS.length)]+"\n";
    }

    col.textContent=text;
    col.style.animationDuration=`${9+Math.random()*6}s`;
    col.style.animationDelay=`${-Math.random()*10}s`;
    ambient.appendChild(col);
  }
}

function decodeHomeCell(
  el,
  finalChar,
  pool,
  {
    scrambleMs=HOME_SCRAMBLE,
    tickMs=HOME_GROUP_TICK,
    startDelay=0,
    counter=false,
    runId=homeCycleRun
  }={}
){
  homeLater(()=>{
    if(runId!==homeCycleRun || $("#homeScreen").hidden)return;
    el.classList.remove("home-locked","home-reveal","home-letter-pop","home-count-pop");
    el.classList.add("home-scrambling");
    el.textContent=randomHomeItem(pool);
    homeLater(()=>{
      revealHomeBox(el,finalChar,{counter,runId});
    },counter ? HOME_COUNT_SCRAMBLE : scrambleMs);
  },startDelay);
}

function setHomeScrambleFrame(items,runId){
  if(runId!==homeCycleRun || $("#homeScreen").hidden)return;

  items.forEach(({el,pool})=>{
    if(!el.classList.contains("home-scrambling"))return;
    el.textContent=randomHomeItem(pool);
  });
}

function startHomeScrambleLoop(items,runId){
  if(runId!==homeCycleRun || $("#homeScreen").hidden)return;

  items.forEach(({el,pool})=>{
    el.classList.remove("home-locked","home-reveal","home-letter-pop","home-count-pop");
    el.classList.add("home-scrambling");
    el.textContent=randomHomeItem(pool);
  });

  const handle=setInterval(()=>{
    if(runId!==homeCycleRun || $("#homeScreen").hidden){
      clearInterval(handle);
      return;
    }

    const active=items.filter(({el})=>el.classList.contains("home-scrambling"));

    if(active.length===0){
      clearInterval(handle);
      return;
    }

    setHomeScrambleFrame(active,runId);
  },HOME_GROUP_TICK);

  homeScrambleHandles.push(handle);
}

function revealHomeBox(el,finalChar,{counter=false,runId=homeCycleRun}={}){
  if(runId!==homeCycleRun || $("#homeScreen").hidden)return;
  el.classList.remove("home-scrambling","home-locked","home-reveal","home-letter-pop","home-count-pop");
  el.textContent=finalChar;
  el.classList.add(counter ? "home-reveal" : "home-locked");
  void el.offsetWidth;
  el.classList.add(counter ? "home-count-pop" : "home-letter-pop");
}

function playHomeDecodeCycle(){
  const home=$("#homeScreen");
  if(!home || home.hidden)return;

  clearHomeTimers();
  clearHomeScrambles();
  const runId=++homeCycleRun;
  const demo=HOME_DEMOS[homeDemoIndex];
  const tiles=[...document.querySelectorAll(".animated-letter")];
  const counts=[
    $("#homeGreenCount"),
    $("#homeYellowCount"),
    $("#homeRedCount")
  ].filter(Boolean);

  if(tiles.length!==5 || counts.length!==3)return;

  const tileItems=tiles.map(tile=>({el:tile,pool:HOME_LETTERS}));
  const countItems=counts.map(count=>({el:count,pool:HOME_DIGITS}));
  const allItems=[...tileItems,...countItems];

  allItems.forEach(({el})=>{
    el.classList.remove("home-scrambling","home-locked","home-reveal","home-letter-pop","home-count-pop");
    el.textContent="";
  });

  /* Harfler ve sayılar birlikte yeşil scramble'a girer.
     Her kutu kendi sırası gelene kadar yeşil olarak akmaya devam eder. */
  startHomeScrambleLoop(allItems,runId);

  const revealStart=HOME_GROUP_FLASHES*HOME_GROUP_TICK+20;

  tiles.forEach((tile,index)=>{
    homeLater(()=>{
      revealHomeBox(tile,demo.word[index],{counter:false,runId});
    },revealStart+index*HOME_STEP);
  });

  /* 5 harften sonra sayaçlar aynı HOME_STEP ritmini kesmeden devam eder. */
  const countsStart=revealStart+tiles.length*HOME_STEP;
  counts.forEach((count,index)=>{
    homeLater(()=>{
      revealHomeBox(count,String(demo.counts[index]),{counter:true,runId});
    },countsStart+index*HOME_STEP);
  });

  const totalDuration=countsStart+counts.length*HOME_STEP+HOME_HOLD;
  homeLater(()=>{
    if(runId!==homeCycleRun || home.hidden)return;
    homeDemoIndex=(homeDemoIndex+1)%HOME_DEMOS.length;
    playHomeDecodeCycle();
  },totalDuration);
}

function startHomeWordAnimation(){
  stopHomeWordAnimation();
  ensureHomeMatrixRain();
  homeDemoIndex=0;
  playHomeDecodeCycle();
}

function stopHomeWordAnimation(){
  clearHomeTimers();
  clearHomeScrambles();
  homeCycleRun++;
}

function bootstrapApp(){
  applySettings();

  /* Arayüzü ağ isteğine bağlama. TDK havuzu arka planda yenilenirken
     uygulama yerel doğrulanmış havuzla anında açılır. */
  applyCanonicalTdkPools(WORD_POOLS);
  setWordLength(5,CURRENT_ANSWER_VERSION);
  buildKeyboard();
  ONLINE?.bootstrap?.().catch(error=>console.warn("Online profil başlatılamadı:",error));

  if(!startSharedPuzzleFromUrl()){
    restoreGame();
    buildBoard();
    render();
    showHome();
    startLiveRoomFromUrl();
  }

  hydrateTdkWordPools().then(()=>{
    try{
      /* TDK listesi geldiyse aktif oyunun kelime doğrulamasını da
         güncel havuza geçir; mevcut tahta/cevap durumu değişmez. */
      setWordLength(COLS,gameAnswerVersion);
      renderKeyboardUsage();
    }catch(error){
      console.warn("TDK havuzu uygulanamadı:",error);
    }
  }).catch(error=>console.warn("TDK havuzu yenilenemedi:",error));
}

try{
  bootstrapApp();
}catch(error){
  console.error("Uygulama başlatılamadı:",error);
  try{
    ANSWER_POOL_VERSIONS.A3=ANSWER_POOL_VERSIONS.A2;
    setWordLength(5,CURRENT_ANSWER_VERSION);
    buildKeyboard();
    restoreGame();
    buildBoard();
    render();
    showHome();
  }catch(fallbackError){
    console.error("Yedek açılış da başarısız:",fallbackError);
  }
}


/* PWA / offline cache */
if("serviceWorker" in navigator && location.protocol.startsWith("http")){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("./sw.js").catch(err=>{
      console.warn("Service worker kaydedilemedi:",err);
    });
  });
}
