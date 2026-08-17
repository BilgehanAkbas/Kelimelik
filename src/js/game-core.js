(function(root,factory){
  const api=factory();
  if(typeof module==="object" && module.exports){
    module.exports=api;
  }else{
    root.KELIMELIK_CORE=api;
  }
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  function calculateFeedback(guess,answer){
    if(guess.length!==answer.length){
      throw new Error("Tahmin ve cevap uzunluğu aynı olmalı.");
    }

    const result=Array(answer.length).fill("red");
    const pool=[...answer];

    for(let i=0;i<answer.length;i++){
      if(guess[i]===answer[i]){
        result[i]="green";
        pool[i]=null;
      }
    }

    for(let i=0;i<answer.length;i++){
      if(result[i]==="green")continue;
      const index=pool.indexOf(guess[i]);
      if(index!==-1){
        result[i]="yellow";
        pool[index]=null;
      }
    }

    return {
      green:result.filter(x=>x==="green").length,
      yellow:result.filter(x=>x==="yellow").length,
      red:result.filter(x=>x==="red").length,
      pattern:result
    };
  }

  function sameCountFeedback(a,b){
    return a.green===b.green && a.yellow===b.yellow && a.red===b.red;
  }

  function possibleSecrets(words,completed){
    if(!completed.length)return [...words];

    return words.filter(candidate=>
      completed.every(item=>
        sameCountFeedback(
          calculateFeedback(item.guess,candidate),
          item.feedback
        )
      )
    );
  }

  function filterHintWordsByGreenFloor(candidates,answer,minGreen=0){
    const floor=Math.max(0,Number(minGreen)||0);
    if(!Array.isArray(candidates) || !candidates.length)return [];
    if(!answer || floor<=0)return [...candidates];

    return candidates.filter(word=>
      calculateFeedback(word,answer).green>=floor
    );
  }

  function scoreHintWords(candidates,locale="tr"){
    if(!candidates.length)return [];

    const frequency=new Map();
    for(const word of candidates){
      for(const ch of new Set(word)){
        frequency.set(ch,(frequency.get(ch)||0)+1);
      }
    }

    return candidates.map(word=>{
      const unique=[...new Set(word)];
      let score=unique.reduce((sum,ch)=>sum+(frequency.get(ch)||0),0);
      score+=unique.length*candidates.length*.18;
      return {word,score};
    }).sort((a,b)=>b.score-a.score || a.word.localeCompare(b.word,locale));
  }

  function hashSeed(text){
    let h=2166136261;
    for(const ch of String(text)){
      h^=ch.charCodeAt(0);
      h=Math.imul(h,16777619);
    }
    return h>>>0;
  }

  function versionNumber(answerVersion){
    const match=String(answerVersion||"A1").toUpperCase().match(/^A(\d+)$/);
    return match ? match[1] : "1";
  }

  function buildGameCode(length,seed,answerVersion="A1"){
    const clean=String(seed||"")
      .replace(/[^A-Z0-9]/gi,"")
      .toUpperCase()
      .slice(0,8);

    if(!clean || ![4,5,6].includes(Number(length)))return "";
    return `K${versionNumber(answerVersion)}-${Number(length)}-${clean}`;
  }

  function parseGameCode(code){
    const value=String(code||"").trim().toUpperCase();

    // Current stable format: K1-5-ABC123
    let match=value.match(/^K(\d+)-([456])-([A-Z0-9]{3,8})$/);
    if(match){
      return {
        version:`A${Number(match[1])}`,
        length:Number(match[2]),
        seed:match[3],
        legacy:false
      };
    }

    // Backward compatibility with v29 codes: K5-ABC123 -> A1
    match=value.match(/^K([456])-([A-Z0-9]{3,8})$/);
    if(match){
      return {
        version:"A1",
        length:Number(match[1]),
        seed:match[2],
        legacy:true
      };
    }

    return null;
  }

  function chooseSeededWord(answerPools,version,length,seed){
    const pool=answerPools?.[version]?.[String(length)] || [];
    if(!pool.length)throw new Error(`Cevap havuzu bulunamadı: ${version}/${length}`);
    /*
     * A1 deliberately preserves the pre-versioning hash recipe.
     * The version selects the frozen pool; it is NOT added to the hash.
     * Therefore K5-ABC123 (legacy) and K1-5-ABC123 resolve to the same A1 word.
     */
    return pool[hashSeed(`${length}:${seed}`)%pool.length];
  }

  function parseDateKey(dateKey){
    const [y,m,d]=String(dateKey).split("-").map(Number);
    if(!y || !m || !d)return null;
    return Date.UTC(y,m-1,d);
  }

  function daysBetween(startKey,endKey){
    const start=parseDateKey(startKey);
    const end=parseDateKey(endKey);
    if(start===null || end===null)throw new Error("Geçersiz tarih.");
    return Math.floor((end-start)/86400000);
  }

  function dailyPuzzleNumber(dateKey,epochKey){
    return daysBetween(epochKey,dateKey)+1;
  }

  function activeDailySeries(series,dateKey){
    const eligible=(series||[])
      .filter(item=>item?.start && item.start<=dateKey && Array.isArray(item.answers) && item.answers.length)
      .sort((a,b)=>a.start.localeCompare(b.start));

    return eligible.length ? eligible[eligible.length-1] : null;
  }

  function chooseDailyWord(series,dateKey,epochKey){
    const active=activeDailySeries(series,dateKey);
    if(!active)throw new Error("Bu tarih için günlük bulmaca serisi bulunamadı.");

    const index=daysBetween(active.start,dateKey);
    if(index<0)throw new Error("Günlük seri henüz başlamadı.");

    return {
      word:active.answers[index%active.answers.length],
      number:dailyPuzzleNumber(dateKey,epochKey),
      version:active.version
    };
  }

  function previousDateKey(dateKey){
    const ms=parseDateKey(dateKey);
    if(ms===null)throw new Error("Geçersiz tarih.");
    const d=new Date(ms-86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
  }

  function updateStatBucket(bucket,won,tries,{daily=false,today}={}){
    if(!bucket || !today)throw new Error("İstatistik güncellemesi için bucket ve today gerekir.");

    if(daily && bucket.lastPlayedDate && bucket.lastPlayedDate!==today){
      if(bucket.lastPlayedDate!==previousDateKey(today)){
        bucket.currentStreak=0;
      }
    }

    bucket.gamesPlayed=(Number(bucket.gamesPlayed)||0)+1;

    if(won){
      bucket.wins=(Number(bucket.wins)||0)+1;
      bucket.currentStreak=(Number(bucket.currentStreak)||0)+1;
      bucket.maxStreak=Math.max(Number(bucket.maxStreak)||0,bucket.currentStreak);

      if(tries>=1 && tries<=8){
        bucket.guessDistribution[tries-1]=(Number(bucket.guessDistribution[tries-1])||0)+1;
        bucket.totalWinningGuesses=(Number(bucket.totalWinningGuesses)||0)+tries;
        bucket.bestWin=bucket.bestWin===null || bucket.bestWin===undefined
          ? tries
          : Math.min(Number(bucket.bestWin)||tries,tries);
        bucket.hasDetailedGuessData=true;
      }
    }else{
      bucket.currentStreak=0;
    }

    bucket.lastPlayedDate=today;
    return bucket;
  }

  return Object.freeze({
    calculateFeedback,
    sameCountFeedback,
    possibleSecrets,
    filterHintWordsByGreenFloor,
    scoreHintWords,
    hashSeed,
    buildGameCode,
    parseGameCode,
    chooseSeededWord,
    dailyPuzzleNumber,
    activeDailySeries,
    chooseDailyWord,
    previousDateKey,
    updateStatBucket
  });
});
