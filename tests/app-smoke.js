const fs=require("fs");
const path=require("path");
const vm=require("vm");
const assert=require("assert");

const ROOT=path.resolve(__dirname,"..");

class ClassList{
  constructor(el){this.el=el;}
  set(){return new Set((this.el.className||"").split(/\s+/).filter(Boolean));}
  write(set){this.el.className=[...set].join(" ");}
  add(...items){const s=this.set();items.forEach(x=>s.add(x));this.write(s);}
  remove(...items){const s=this.set();items.forEach(x=>s.delete(x));this.write(s);}
  toggle(item,force){
    const s=this.set();
    const on=force===undefined?!s.has(item):Boolean(force);
    if(on)s.add(item); else s.delete(item);
    this.write(s);
    return on;
  }
  contains(item){return this.set().has(item);}
}

class Style{
  setProperty(key,value){this[key]=value;}
}

class Element{
  constructor(tag="div"){
    this.tagName=tag.toUpperCase();
    this.children=[];
    this.parentNode=null;
    this.dataset={};
    this.style=new Style();
    this.hidden=false;
    this.disabled=false;
    this.textContent="";
    this.className="";
    this.classList=new ClassList(this);
    this.id="";
    this.onclick=null;
    this.onchange=null;
    this.oninput=null;
    this.onkeydown=null;
    this.oninput=null;
    this.onkeydown=null;
    this.href="";
    this.value="";
    this.maxLength=-1;
  }

  appendChild(el){
    el.parentNode=this;
    this.children.push(el);
    return el;
  }

  remove(){
    if(this.parentNode){
      this.parentNode.children=this.parentNode.children.filter(x=>x!==this);
    }
  }

  blur(){}
  focus(){}
  get offsetWidth(){return 1;}

  set innerHTML(html){
    this.children=[];
    this._innerHTML=String(html||"");

    /* Uygulama ilk açılışında buildKeyboard'ın eklediği action butonlarını
       minimal DOM testinde de görünür yap. */
    for(const match of this._innerHTML.matchAll(/<button([^>]*)>(.*?)<\/button>/gms)){
      const button=new Element("button");
      const attrs=match[1];

      button.textContent=match[2].replace(/<[^>]*>/g,"").trim();

      const id=attrs.match(/id="([^"]+)"/);
      if(id)button.id=id[1];

      const klass=attrs.match(/class="([^"]+)"/);
      if(klass)button.className=klass[1];

      for(const data of attrs.matchAll(/data-([\w-]+)="([^"]*)"/g)){
        const key=data[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
        button.dataset[key]=data[2];
      }

      if(/disabled/.test(attrs))button.disabled=true;
      this.appendChild(button);
    }
  }

  get innerHTML(){return this._innerHTML||"";}
  querySelector(selector){return queryAll([this],selector,true)[0]||null;}
  querySelectorAll(selector){return queryAll([this],selector,true);}
  getBoundingClientRect(){return {width:300,height:100,top:0,left:0,right:300,bottom:100};}
}

function descendants(root,includeRoot=false){
  const output=[];
  if(includeRoot)output.push(root);

  (function walk(node){
    for(const child of node.children){
      output.push(child);
      walk(child);
    }
  })(root);

  return output;
}

function matches(el,selector){
  if(selector.startsWith("#"))return el.id===selector.slice(1);

  const klass=(selector.match(/\.([\w-]+)/)||[])[1];
  if(klass && !el.classList.contains(klass))return false;

  for(const match of selector.matchAll(/\[data-([\w-]+)(?:="?([^\]"]+)"?)?\]/g)){
    const key=match[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
    if(!(key in el.dataset))return false;
    if(match[2]!==undefined && String(el.dataset[key])!==match[2])return false;
  }

  if(/^button/.test(selector) && el.tagName!=="BUTTON")return false;
  return Boolean(klass || selector.startsWith("[") || /^button/.test(selector));
}

function queryAll(roots,selector,includeRoot=false){
  const simple=selector.trim().split(/\s+/).pop();
  const all=[];

  for(const root of roots){
    all.push(...descendants(root,includeRoot));
  }

  return all.filter(el=>matches(el,simple));
}

class Document{
  constructor(){
    this.documentElement=new Element("html");
    this.body=new Element("body");
    this.documentElement.appendChild(this.body);
    this.roots=[this.documentElement];
    this.byId=new Map();

    for(const id of [
      "board","keyboard","modalBackdrop","modalBody","modalClose",
      "homeScreen","gameScreen","startGameBtn","homeHowBtn","privacyBtn",
      "gameHowBtn","gameShareBtn","modeBtn","profileBtn","brandHome",
      "homeGreenCount","homeYellowCount","homeRedCount"
    ]){
      const el=new Element("div");
      el.id=id;
      this.byId.set(id,el);
      this.body.appendChild(el);
    }

    this.byId.get("modalBackdrop").hidden=true;
    this.byId.get("gameScreen").hidden=true;
  }

  createElement(tag){return new Element(tag);}
  querySelector(selector){
    if(selector.startsWith("#"))return this.byId.get(selector.slice(1))||null;
    return queryAll(this.roots,selector,true)[0]||null;
  }
  querySelectorAll(selector){return queryAll(this.roots,selector,true);}
  getElementById(id){return this.byId.get(id)||null;}
  addEventListener(){}
}

class Storage{
  constructor(initial={}){
    this.map=new Map(Object.entries(initial));
  }
  getItem(key){return this.map.has(key)?this.map.get(key):null;}
  setItem(key,value){this.map.set(key,String(value));}
  removeItem(key){this.map.delete(key);}
  clear(){this.map.clear();}
}

function loadApp(storageInitial={}){
  const document=new Document();
  const localStorage=new Storage(storageInitial);

  const window={
    document,
    localStorage,
    innerWidth:1024,
    addEventListener(){},
    crypto:{
      getRandomValues(array){
        for(let i=0;i<array.length;i++)array[i]=123456+i;
        return array;
      }
    }
  };

  window.window=window;

  const context={
    window,document,localStorage,
    navigator:{},
    fetch:async()=>({
      ok:true,
      async json(){
        return [{
          madde:"damat",
          anlamlarListe:[
            {anlam:"Bir ailenin kızını evlendirdiği erkek."},
            {anlam:"Güvey."}
          ]
        }];
      }
    }),
    AbortController:class{
      constructor(){this.signal={};}
      abort(){}
    },
    location:{protocol:"file:",origin:"",pathname:"/"},
    getComputedStyle(){return {getPropertyValue(){return "";}};},
    console,Intl,Date,Math,JSON,Set,Map,Array,Object,String,Number,Boolean,RegExp,
    encodeURIComponent,decodeURIComponent,
    setTimeout(){return 0;},
    clearTimeout(){},
    setInterval(){return 0;},
    clearInterval(){},
    requestAnimationFrame(fn){if(typeof fn==="function")fn();return 0;},
    confirm(){return true;}
  };

  vm.createContext(context);

  vm.runInContext(
    fs.readFileSync(path.join(ROOT,"src/js/game-core.js"),"utf8"),
    context,
    {filename:"game-core.js"}
  );

  window.KELIMELIK_CORE=context.KELIMELIK_CORE;

  vm.runInContext(
    fs.readFileSync(path.join(ROOT,"src/js/word-pools.js"),"utf8"),
    context,
    {filename:"word-pools.js"}
  );

  vm.runInContext(
    fs.readFileSync(path.join(ROOT,"src/js/app.js"),"utf8"),
    context,
    {filename:"app.js"}
  );

  /* bootstrapApp TDK havuzunu ağdan async hydrate ediyor. Bu minimal VM
     smoke ortamı event-loop/fetch tamamlanmasını beklemeden assertionlara
     geçtiği için, bootstrap'ın hydrate sonrasındaki senkron bölümünü burada
     deterministik olarak çalıştırıyoruz. */
  vm.runInContext(`
    applySettings();
    applyCanonicalTdkPools(WORD_POOLS);
    setWordLength(5,CURRENT_ANSWER_VERSION);
    buildKeyboard();
    restoreGame();
    buildBoard();
    render();
    showHome();
  `,context);

  return {
    document,
    localStorage,
    eval(code){return vm.runInContext(code,context);}
  };
}

const fresh=loadApp();

assert.strictEqual(fresh.eval("COLS"),5);
assert.strictEqual(fresh.eval("gameAnswerVersion"),"A3");
assert.strictEqual(fresh.document.querySelectorAll(".tile").length,40);
assert.strictEqual(fresh.document.querySelectorAll(".counter").length,24);
assert(fresh.eval("VALID_WORDS.has(secretWord)"));

for(const length of [4,5,6]){
  fresh.eval(`newGame("practice",${length},"SMOKE${length}","A1")`);
  assert.strictEqual(fresh.eval("COLS"),length);
  assert.strictEqual(
    fresh.document.querySelectorAll(".tile").length,
    8*length
  );
  assert(fresh.eval("VALID_WORDS.has(secretWord)"));
}

console.log("✓ app.js temiz kurulum + 4/5/6 başlangıcı");

const freshAnswerApp=loadApp();
freshAnswerApp.eval(`
  let __answerRandomCounter=1000;
  window.crypto.getRandomValues=array=>{
    for(let i=0;i<array.length;i++)array[i]=__answerRandomCounter++;
    return array;
  };
  setWordLength(4,"A2");
`);
const firstFresh=freshAnswerApp.eval('chooseFreshRandomSecret("A2")');
freshAnswerApp.eval(`rememberRecentAnswer(${JSON.stringify(firstFresh.word)},4)`);
const secondFresh=freshAnswerApp.eval('chooseFreshRandomSecret("A2")');
assert.notStrictEqual(secondFresh.word,firstFresh.word,"son cevap kısa aralıkta tekrar seçildi");
freshAnswerApp.eval('ANSWER_WORDS.slice(0,30).forEach(word=>rememberRecentAnswer(word,4))');
assert.strictEqual(freshAnswerApp.eval('loadRecentAnswers(4).length'),24);
freshAnswerApp.eval('rememberRecentAnswer(ANSWER_WORDS[0],4); rememberRecentAnswer(ANSWER_WORDS[0],4)');
assert.strictEqual(freshAnswerApp.eval('loadRecentAnswers(4).filter(word=>word===ANSWER_WORDS[0]).length'),1);
console.log("✓ A2 random oyunlarda son 24 cevap tekrar koruması");

const seed="MIGRATE1";
fresh.eval(`setWordLength(5,"A1")`);
const secret=fresh.eval(
  `CORE.chooseSeededWord(ANSWER_POOL_VERSIONS,"A1",5,"${seed}")`
);

const guesses=Array.from(
  {length:8},
  ()=>Array.from({length:5},()=>({letter:"",state:"none"}))
);

const oldGame={
  guesses,
  feedbacks:Array(8).fill(null),
  submitted:Array(8).fill(false),
  activeRow:0,
  activeCol:0,
  secretWord:secret,
  hintUsed:false,
  gameMode:"practice",
  gameFinished:false,
  COLS:5,
  gameSeed:seed
};

const emptyLegacyBucket=()=>({
  gamesPlayed:0,
  wins:0,
  currentStreak:0,
  maxStreak:0,
  guessDistribution:Array(8).fill(0),
  lastPlayedDate:null
});

const oldStats={
  overall:{
    gamesPlayed:2,
    wins:2,
    currentStreak:2,
    maxStreak:2,
    guessDistribution:[0,1,1,0,0,0,0,0],
    lastPlayedDate:"2026-08-13"
  },
  daily:emptyLegacyBucket(),
  classic:{
    "4":emptyLegacyBucket(),
    "5":{
      gamesPlayed:2,
      wins:2,
      currentStreak:2,
      maxStreak:2,
      guessDistribution:[0,1,1,0,0,0,0,0],
      lastPlayedDate:"2026-08-13"
    },
    "6":emptyLegacyBucket()
  }
};

const migrated=loadApp({
  "kelimelik-game-v18":JSON.stringify(oldGame),
  "kelimelik-stats-v2":JSON.stringify(oldStats)
});

assert.strictEqual(migrated.eval("secretWord"),secret);
assert.strictEqual(migrated.eval("gameAnswerVersion"),"A1");
assert.strictEqual(migrated.eval("loadStats().overall.totalWinningGuesses"),5);
assert.strictEqual(migrated.eval("loadStats().overall.bestWin"),2);

console.log("✓ v27/v29 aktif oyun + istatistik migration");

migrated.eval(`
  localStorage.setItem(
    "kelimelik-daily-v2",
    JSON.stringify({
      date:"2026-08-13",
      completed:true,
      won:true,
      tries:3
    })
  )
`);

assert.strictEqual(migrated.eval("dailyPlayedToday()"),false);
console.log("✓ önceki gün günlük kaydı yeni günü engellemiyor");

migrated.eval(`newGame("practice",5,"ABCDEFGH","A1")`);

const code=migrated.eval(
  "buildGameCode(COLS,gameSeed,gameAnswerVersion)"
);

assert.strictEqual(code,"K1-5-ABCDEFGH");
assert.strictEqual(
  migrated.eval(`parseGameCode("${code}").seed`),
  "ABCDEFGH"
);



const keyboardApp=loadApp();
keyboardApp.eval(`newGame("practice",5,"KEYBOARD","A1"); buildKeyboard();`);

assert(
  keyboardApp.document.querySelectorAll(".key[data-letter]").length>=32,
  "Türkçe Q klavyesi oluşmadı"
);

keyboardApp.eval(`addLetter("K"); addLetter("A"); addLetter("L"); addLetter("E"); addLetter("M");`);
assert.strictEqual(
  keyboardApp.eval(`guesses[0].map(x=>x.letter).join("")`),
  "KALEM"
);

keyboardApp.eval(`submitted[0]=true; renderKeyboardUsage();`);
for(const letter of ["K","A","L","E","M"]){
  const key=keyboardApp.document.querySelector(`.key[data-letter="${letter}"]`);
  assert(key && key.classList.contains("used"),`${letter} tuşu koyulaşmadı`);
}
console.log("✓ oyun klavyesi harf girişi ve kullanılan harf koyulaştırması");

for(const viewport of [320,375,390,430]){
  keyboardApp.eval(`window.innerWidth=${viewport}`);
  for(const length of [4,5,6]){
    keyboardApp.eval(`setWordLength(${length},"A1"); buildBoard();`);
    const size=parseInt(keyboardApp.document.querySelector("#board").style["--s"],10);
    const gap=parseInt(keyboardApp.document.querySelector("#board").style["--board-gap"],10);
    const total=(length+3)*size+(length+2)*gap;
    assert(total<=viewport,`Tahta taşıyor: ${viewport}px / ${length} harf / ${total}px`);
  }
}
console.log("✓ 320/375/390/430 px mobil board genişlik testi");


const meaningApp=loadApp();
const parsedMeanings=meaningApp.eval(`
  extractTdkMeanings([{
    madde:"damat",
    anlamlarListe:[
      {anlam:"Birinci anlam"},
      {anlam:"İkinci anlam"}
    ]
  }])
`);
assert.strictEqual(parsedMeanings.length,2);
assert.strictEqual(parsedMeanings[0],"Birinci anlam");
assert.strictEqual(
  meaningApp.eval(`tdkApiUrl("DAMAT")`),
  "https://sozluk.gov.tr/gts?ara=damat"
);
console.log("✓ TDK anlam parserı ve endpoint URL üretimi");

const dailyResumeApp=loadApp();
dailyResumeApp.eval(`newGame("daily",5);`);
dailyResumeApp.eval(`addLetter("K"); addLetter("A");`);
assert.strictEqual(dailyResumeApp.eval(`guesses[0].map(x=>x.letter).join("")`),"KA");
assert(dailyResumeApp.localStorage.getItem("kelimelik-daily-progress-v1"));
dailyResumeApp.eval(`newGame("practice",5,"CLASSIC1","A1");`);
dailyResumeApp.eval(`newGame("daily",5);`);
assert.strictEqual(dailyResumeApp.eval(`guesses[0].map(x=>x.letter).join("")`),"KA");
assert.strictEqual(dailyResumeApp.eval("gameMode"),"daily");
console.log("✓ yarım günlük bulmaca klasik oyundan sonra bile devam ediyor");

const physicalApp=loadApp();
physicalApp.eval(`newGame("practice",5,"PHYSKEY","A1"); showGame();`);
physicalApp.eval(`
  handlePhysicalGameKey({key:"k",ctrlKey:false,metaKey:false,altKey:false,target:{tagName:"BODY"},preventDefault(){}});
  handlePhysicalGameKey({key:"i",ctrlKey:false,metaKey:false,altKey:false,target:{tagName:"BODY"},preventDefault(){}});
`);
assert.strictEqual(physicalApp.eval(`guesses[0].map(x=>x.letter).join("")`),"Kİ");
physicalApp.eval(`handlePhysicalGameKey({key:"Backspace",ctrlKey:false,metaKey:false,altKey:false,target:{tagName:"BODY"},preventDefault(){}});`);
assert.strictEqual(physicalApp.eval(`guesses[0].map(x=>x.letter).join("")`),"K");
console.log("✓ PC klavyesi Türkçe harf ve Backspace girişini destekliyor");

const settingsApp=loadApp();
settingsApp.eval(`saveSettings({animations:false,colorBlind:true});`);
assert.strictEqual(settingsApp.eval("loadSettings().animations"),false);
assert.strictEqual(settingsApp.eval("loadSettings().colorBlind"),true);
assert(settingsApp.document.getElementById("gameScreen").classList.contains("reduce-motion"));
assert(!settingsApp.document.documentElement.classList.contains("reduce-motion"));
assert(settingsApp.document.documentElement.classList.contains("color-blind"));
console.log("✓ animasyon ayarı yalnızca oyun ekranını, renk körü ayarı genel paleti etkiliyor");


const repairApp=loadApp();
const repairToday=repairApp.eval("todayKey()");
const repairWord=repairApp.eval("getDailyPuzzleInfo().word");
repairApp.localStorage.setItem("kelimelik-daily-v2",JSON.stringify({
  date:repairToday,
  completed:true,
  won:false,
  tries:null
}));
repairApp.localStorage.setItem("kelimelik-history-v1",JSON.stringify([{
  id:"daily-win-repair",
  word:repairWord,
  length:5,
  mode:"daily",
  won:true,
  tries:5,
  date:new Date().toISOString()
}]));
repairApp.eval(`
  const s=loadStats();
  s.daily.gamesPlayed=1;
  s.daily.wins=0;
  s.daily.currentStreak=0;
  s.daily.maxStreak=0;
  s.daily.lastPlayedDate=todayKey();
  saveStats(s);
  repairTodayDailyState();
`);
const repairedRecord=JSON.parse(repairApp.localStorage.getItem("kelimelik-daily-v2"));
const repairedStats=JSON.parse(repairApp.localStorage.getItem("kelimelik-stats-v2"));
assert.strictEqual(repairedRecord.won,true);
assert.strictEqual(repairedRecord.tries,5);
assert.strictEqual(repairedRecord.word,repairWord);
assert.strictEqual(repairedStats.daily.wins,1);
assert.strictEqual(repairedStats.daily.guessDistribution[4],1);
console.log("✓ eski günlük kayıp kaydı kazanılan geçmiş sonucundan onarılıyor");

const sharedOnceApp=loadApp();
sharedOnceApp.eval(`
  setWordLength(5,"A1");
  gameMode="shared";
  sharedPuzzleToken="klasik-5-A1-ABC123";
  gameSeed="ABC123";
  secretWord=chooseSeededSecret(gameSeed,"A1");
  guesses=emptyRows();
  feedbacks=Array.from({length:ROWS},()=>null);
  submitted=Array(ROWS).fill(false);
  activeRow=0;
  activeCol=0;
  hintUsed=false;
  gameFinished=false;
  saveGame();
  saveSharedPlay(sharedPuzzleToken,{completed:true,won:true,tries:4,word:secretWord,length:5,gameFinished:true});
`);
const sharedOnceRecord=JSON.parse(sharedOnceApp.localStorage.getItem("kelimelik-shared-play-v1"));
assert.strictEqual(sharedOnceRecord["klasik-5-A1-ABC123"].completed,true);
assert.strictEqual(sharedOnceApp.eval(`sharedPuzzleCompleted("klasik-5-A1-ABC123")`),true);
assert.strictEqual(sharedOnceApp.eval(`buildPuzzleInviteText()`),"Kelimelik'te sana bir bulmaca gönderdim. Çözebilir misin?");
console.log("✓ paylaşılan bulmaca tamamlanma kaydı ve paylaşım mesajı doğru");


const duplicateDailyApp=loadApp();
const duplicateDate=duplicateDailyApp.eval("todayKey()");
const duplicateWord=duplicateDailyApp.eval("getDailyPuzzleInfo().word");
const duplicateNow=new Date().toISOString();

duplicateDailyApp.localStorage.setItem("kelimelik-daily-v2",JSON.stringify({
  date:duplicateDate,completed:true,won:false,tries:null,word:duplicateWord
}));
duplicateDailyApp.localStorage.setItem("kelimelik-history-v1",JSON.stringify([
  {id:"shared-win",word:duplicateWord,length:5,mode:"shared",won:true,tries:1,date:duplicateNow},
  {id:"daily-loss",word:duplicateWord,length:5,mode:"daily",won:false,tries:null,date:duplicateNow}
]));

const duplicateHistory=duplicateDailyApp.eval("loadHistory()");
assert.strictEqual(duplicateHistory.length,1);
assert.strictEqual(duplicateHistory[0].mode,"daily");
assert.strictEqual(duplicateHistory[0].won,true);
assert.strictEqual(duplicateHistory[0].tries,1);
assert.strictEqual(duplicateHistory[0].puzzleKey,`daily:${duplicateDate}`);

duplicateDailyApp.eval(`
  const s=loadStats();
  s.daily.gamesPlayed=1;
  s.daily.wins=0;
  s.daily.lastPlayedDate=todayKey();
  saveStats(s);
  repairTodayDailyState();
`);
const duplicateRecord=JSON.parse(duplicateDailyApp.localStorage.getItem("kelimelik-daily-v2"));
assert.strictEqual(duplicateRecord.won,true);
assert.strictEqual(duplicateRecord.tries,1);
console.log("✓ günlük/shared duplicate geçmiş tek günlük kazanca onarılıyor");

const incompleteGuessApp=loadApp();
incompleteGuessApp.eval('newGame("practice",5,"MISS123","A1")');
incompleteGuessApp.eval('guesses[0][0]={letter:"K",state:"none"}; activeCol=1; submitGuess();');
assert.strictEqual(incompleteGuessApp.eval("submitted[0]"),false);
assert.strictEqual(incompleteGuessApp.eval("activeRow"),0);
assert.strictEqual(incompleteGuessApp.eval("gameFinished"),false);
console.log("✓ eksik tahmin popup açmadan hakkı koruyor");


const classicModeApp=loadApp();
assert.strictEqual(classicModeApp.eval('newGame("classic",5,"CLASSIC1","A1")'),true);
assert.strictEqual(classicModeApp.eval("gameMode"),"classic");
assert.strictEqual(classicModeApp.eval("gameVariant"),"classic");
assert.strictEqual(classicModeApp.eval("currentAttemptLimit()"),6);

classicModeApp.eval(`
  guesses[0]=[...secretWord].map(letter=>({letter,state:"none"}));
  activeRow=0;
  activeCol=5;
  submitGuess();
`);
assert.strictEqual(classicModeApp.eval("submitted[0]"),true);
assert.strictEqual(classicModeApp.eval("gameFinished"),true);
assert.strictEqual(classicModeApp.eval("guesses[0].every(cell=>cell.state==='green')"),true);
const classicStats=JSON.parse(classicModeApp.localStorage.getItem("kelimelik-stats-v2"));
assert.strictEqual(classicStats.classicMode.gamesPlayed,1);
assert.strictEqual(classicStats.classicMode.wins,1);
console.log("✓ Klasik Mod 5 harf/6 tahmin ve doğrudan renk feedback ile çalışıyor");


const classic4App=loadApp();
assert.strictEqual(classic4App.eval('newGame("classic",4,"CLASSIC4","A1")'),true);
assert.strictEqual(classic4App.eval("COLS"),4);
assert.strictEqual(classic4App.eval("currentAttemptLimit()"),5);
assert.strictEqual(classic4App.document.getElementById("board").children.length,20);
assert.strictEqual(classic4App.eval('currentPuzzleShareToken().startsWith("klasikmod-4-A1-")'),true);

const classic6App=loadApp();
assert.strictEqual(classic6App.eval('newGame("classic",6,"CLASSIC6","A1")'),true);
assert.strictEqual(classic6App.eval("COLS"),6);
assert.strictEqual(classic6App.eval("currentAttemptLimit()"),7);
assert.strictEqual(classic6App.document.getElementById("board").children.length,42);
assert.strictEqual(classic6App.eval('currentPuzzleShareToken().startsWith("klasikmod-6-A1-")'),true);
console.log("✓ Klasik Mod 4/5/6 uzunluklarında 5/6/7 tahmin ve doğru board boyutunu kullanıyor");

const classicTokenApp=loadApp();
const parsedClassic=classicTokenApp.eval('parsePuzzleShareToken("klasikmod-5-A1-ABC123")');
assert.strictEqual(parsedClassic.mode,"classic");
assert.strictEqual(parsedClassic.length,5);
const parsedLegacy=classicTokenApp.eval('parsePuzzleShareToken("klasik-5-A1-ABC123")');
assert.strictEqual(parsedLegacy.mode,"practice");
console.log("✓ Klasik paylaşım tokenı eski Kelimelik tokenından ayrılıyor");


const classicBoardApp=loadApp();
assert.strictEqual(classicBoardApp.eval('newGame("classic",5,"BOARD001","A1")'),true);
assert.strictEqual(classicBoardApp.document.getElementById("board").children.length,30);
assert.strictEqual(
  classicBoardApp.document.getElementById("board").querySelectorAll(".counter").length,
  0
);
console.log("✓ Klasik Mod board tam 6x5 ve sayaçsız kuruluyor");

const classicLossApp=loadApp();
assert.strictEqual(classicLossApp.eval('newGame("classic",5,"LOSS0001","A1")'),true);
classicLossApp.eval(`
  const wrong=[...VALID_WORDS].find(word=>word.length===5 && word!==secretWord);
  for(let row=0;row<6;row++){
    guesses[row]=[...wrong].map(letter=>({letter,state:"none"}));
    activeRow=row;
    activeCol=5;
    submitGuess();
  }
`);
assert.strictEqual(classicLossApp.eval("gameFinished"),true);
assert.strictEqual(classicLossApp.eval("submitted.slice(0,6).every(Boolean)"),true);
assert.strictEqual(classicLossApp.eval("submitted[6]"),false);
const classicLossHistory=classicLossApp.eval("loadHistory()");
assert.strictEqual(classicLossHistory[0].mode,"classic");
assert.strictEqual(classicLossHistory[0].attemptLimit,6);
assert.strictEqual(classicLossHistory[0].won,false);
console.log("✓ Klasik Mod 6. tahminde kayıp olarak bitiyor ve 7. satıra geçmiyor");

const classicRestoreSource=loadApp();
assert.strictEqual(classicRestoreSource.eval('newGame("classic",5,"REST0001","A1")'),true);
classicRestoreSource.eval(`
  const wrong=[...VALID_WORDS].find(word=>word.length===5 && word!==secretWord);
  guesses[0]=[...wrong].map(letter=>({letter,state:"none"}));
  activeRow=0;
  activeCol=5;
  submitGuess();
`);
const classicSaved=classicRestoreSource.localStorage.getItem("kelimelik-game-v18");

const classicRestoreApp=loadApp({
  "kelimelik-game-v18":classicSaved
});
classicRestoreApp.eval("restoreGame(); buildBoard(); render();");
assert.strictEqual(classicRestoreApp.eval("gameMode"),"classic");
assert.strictEqual(classicRestoreApp.eval("gameVariant"),"classic");
assert.strictEqual(classicRestoreApp.eval("currentAttemptLimit()"),6);
assert.strictEqual(classicRestoreApp.eval("activeRow"),1);
assert.strictEqual(classicRestoreApp.document.getElementById("board").children.length,30);
console.log("✓ Yarım Klasik Mod yenileme sonrası 6 tahmin kuralıyla devam ediyor");

const sharedClassicRuntime=loadApp();
const directPuzzle=sharedClassicRuntime.eval('parsePuzzleShareToken("klasikmod-5-A1-SHARE001")');
assert.strictEqual(sharedClassicRuntime.eval(
  `startSharedClassicPuzzle(${JSON.stringify(directPuzzle)})`
),true);
assert.strictEqual(sharedClassicRuntime.eval("gameMode"),"shared");
assert.strictEqual(sharedClassicRuntime.eval("gameVariant"),"classic");
assert.strictEqual(sharedClassicRuntime.eval("currentAttemptLimit()"),6);
assert.strictEqual(sharedClassicRuntime.document.getElementById("board").children.length,30);
console.log("✓ Paylaşılan Klasik Mod linki doğrudan 6 tahminli klasik oynanışı açıyor");


const wordPoolAuditApp=loadApp();
wordPoolAuditApp.eval('setWordLength(5,"A1")');
assert.strictEqual(wordPoolAuditApp.eval('VALID_WORDS.has("RÜŞEN")'),true);
assert.strictEqual(wordPoolAuditApp.eval('VALID_WORDS.has("OSMAN")'),true);
wordPoolAuditApp.eval('setWordLength(6,"A1")');
assert.strictEqual(wordPoolAuditApp.eval('VALID_WORDS.has("MEHMET")'),true);
assert.strictEqual(wordPoolAuditApp.eval('VALID_WORDS.has("İSMAİL")'),true);
console.log("✓ RÜŞEN ve kontrollü isim allowlist doğru harf uzunluklarında runtime sözlükte kabul ediliyor");

const hintFloorApp=loadApp();
hintFloorApp.eval('newGame("practice",5,"HINTFLO1","A1")');
const hintScenario=hintFloorApp.eval(`(()=>{
  const guess=WORDS.find(word=>{
    if(word===secretWord)return false;
    const fb=calculateFeedback(word,secretWord);
    if(fb.green!==2)return false;
    const possible=CORE.possibleSecrets(WORDS,[{guess:word,feedback:fb}]);
    const eligible=CORE.filterHintWordsByGreenFloor(possible,secretWord,2);
    return eligible.some(candidate=>candidate!==secretWord);
  });
  if(!guess)return null;
  return {guess,feedback:calculateFeedback(guess,secretWord)};
})()`);
assert(hintScenario,"2 yeşilli gerçek ipucu senaryosu bulunamadı");
hintFloorApp.eval(`
  guesses[0]=[...${JSON.stringify(hintScenario.guess)}].map(letter=>({letter,state:"none"}));
  feedbacks[0]=${JSON.stringify(hintScenario.feedback)};
  submitted[0]=true;
  activeRow=1;
  activeCol=0;
  useHint();
`);
assert.strictEqual(hintFloorApp.eval("feedbacks[1].green>=2"),true);
console.log("✓ İpucu mevcut en iyi 2 yeşili koruyor veya artırıyor");

const hintNoWinApp=loadApp();
hintNoWinApp.eval('newGame("practice",5,"HINTNOW1","A1")');
hintNoWinApp.eval(`
  const first=WORDS.find(word=>word!==secretWord && calculateFeedback(word,secretWord).green===0)
    || WORDS.find(word=>word!==secretWord);
  guesses[0]=[...first].map(letter=>({letter,state:"none"}));
  feedbacks[0]=calculateFeedback(first,secretWord);
  submitted[0]=true;
  activeRow=1;
  activeCol=0;
  ANSWER_WORDS=[secretWord];
  useHint();
`);
assert.notStrictEqual(hintNoWinApp.eval('guesses[1].map(cell=>cell.letter).join("")'),hintNoWinApp.eval('secretWord'));
assert.strictEqual(hintNoWinApp.eval("gameFinished"),false);
console.log("✓ İpucu tek olasılık kalsa bile gizli cevabı otomatik oynamıyor");


console.log("✓ sürümlü oyun kodu gerçek app context'inde çalışıyor");


const immediateFinish=loadApp();
immediateFinish.eval('newGame("practice",5,"FINAL123","A1")');
immediateFinish.eval(`
  guesses[0]=[...secretWord].map(letter=>({letter,state:"none"}));
  activeRow=0;
  activeCol=COLS;
  submitGuess();
`);
assert.strictEqual(immediateFinish.eval("gameFinished"),true);
const finishStats=JSON.parse(immediateFinish.localStorage.getItem("kelimelik-stats-v2"));
assert.strictEqual(finishStats.overall.gamesPlayed,1);
assert.strictEqual(finishStats.overall.wins,1);
console.log("✓ son doğru tahmin animasyondan önce kalıcı olarak sonuçlandırılıyor");

const sanitized=loadApp({
  "kelimelik-history-v1":JSON.stringify([{word:'<IMG ONERROR=alert(1)>',mode:"practice",won:true,tries:1}]),
  "kelimelik-favorites-v1":JSON.stringify(['<SCRIPT>'])
});
assert.strictEqual(sanitized.eval("loadHistory().length"),0);
assert.strictEqual(sanitized.eval("loadFavorites().size"),0);
console.log("✓ bozuk/manipüle localStorage kelimeleri geçmiş ve favorilere giremiyor");
