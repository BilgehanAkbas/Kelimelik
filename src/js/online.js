(()=>{
  "use strict";

  const PROFILE_KEY="kelimelik-online-profile-v1";
  const CODE_ALPHABET="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const CONFIG=window.KELIMELIK_ONLINE_CONFIG || {};
  let client=null;
  let sdkPromise=null;
  let anonymousAuthUnavailable=false;

  function storageGet(key){
    try{return localStorage.getItem(key);}catch(e){return null;}
  }

  function storageSet(key,value){
    try{localStorage.setItem(key,value);return true;}catch(e){return false;}
  }

  function normalizeNickname(value){
    return String(value||"")
      .replace(/\s+/g," ")
      .trim()
      .slice(0,18);
  }


  function friendlyErrorMessage(error,fallback="Online işlem tamamlanamadı. Lütfen tekrar dene."){
    const message=String(error?.message||"").trim();
    const code=String(error?.code||"").trim();
    const raw=message || code || String(error||"").trim();
    const lower=[code,message,raw].filter(Boolean).join(" ").toLocaleLowerCase("tr-TR");

    if(!raw)return fallback;

    if(lower.includes("anonymous_provider_disabled") || lower.includes("anonymous sign-ins are disabled") || lower.includes("anonymous provider is disabled")){
      return "Online oturum şu anda başlatılamıyor. Lütfen biraz sonra tekrar dene.";
    }

    if(
      lower.includes("failed to fetch") ||
      lower.includes("networkerror") ||
      lower.includes("network request failed") ||
      lower.includes("load failed")
    ){
      return "Online servise ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.";
    }

    if(
      lower.includes("jwt") ||
      lower.includes("refresh token") ||
      lower.includes("session") && lower.includes("expired") ||
      lower.includes("user from sub claim")
    ){
      return "Online oturum yenilenemedi. Sayfayı yenileyip tekrar dene.";
    }

    if(lower.includes("rate limit") || lower.includes("too many requests")){
      return "Çok fazla istek gönderildi. Birkaç saniye sonra tekrar dene.";
    }

    if(lower.includes("invalid api key") || lower.includes("invalidapikey")){
      return "Online bağlantı yapılandırması doğrulanamadı.";
    }

    const readablePrefixes=[
      "Önce ","Geçersiz ","Oda ","Rakip ","Maç ","Tahmin ","Gizli ",
      "Bu ","Özel ","Kelimelik ","Klasik ","Çevrimiçi ","Online servis ",
      "Kelime havuzunda yok", "Tahmin hakkın kalmadı", "Çok hızlı tepki ", "Rövanş "
    ];
    const readable=message || raw;
    if(readable.length<=180 && readablePrefixes.some(prefix=>readable.startsWith(prefix))){
      return readable;
    }

    return fallback;
  }

  function friendlyError(error,fallback){
    const wrapped=new Error(friendlyErrorMessage(error,fallback));
    try{wrapped.cause=error;}catch(e){}
    return wrapped;
  }

  function validateNickname(value){
    const nickname=normalizeNickname(value);
    if(nickname.length<2)return {ok:false,message:"Takma ad en az 2 karakter olmalı."};
    if(nickname.length>18)return {ok:false,message:"Takma ad en fazla 18 karakter olabilir."};
    if(!/^[A-Za-zÇĞİÖŞÜçğıöşü0-9 _.-]+$/.test(nickname)){
      return {ok:false,message:"Takma adda yalnızca harf, rakam, boşluk, nokta, tire ve alt çizgi kullan."};
    }
    return {ok:true,nickname};
  }

  function randomIndex(max){
    if(window.crypto?.getRandomValues){
      const arr=new Uint32Array(1);
      window.crypto.getRandomValues(arr);
      return arr[0]%max;
    }
    return Math.floor(Math.random()*max);
  }

  function generatePlayerCode(){
    let code="";
    for(let i=0;i<5;i++)code+=CODE_ALPHABET[randomIndex(CODE_ALPHABET.length)];
    return code;
  }

  function getLocalProfile(){
    try{
      const value=JSON.parse(storageGet(PROFILE_KEY)||"null");
      if(!value || typeof value!=="object")return null;
      const valid=validateNickname(value.nickname);
      const code=String(value.playerCode||"").toUpperCase();
      if(!valid.ok || !/^[A-Z2-9]{5}$/.test(code))return null;
      return {
        id:String(value.id||""),
        nickname:valid.nickname,
        playerCode:code,
        synced:Boolean(value.synced),
        createdAt:String(value.createdAt||""),
        updatedAt:String(value.updatedAt||"")
      };
    }catch(e){return null;}
  }

  function persistProfile(profile){
    const now=new Date().toISOString();
    const clean={
      id:String(profile.id||""),
      nickname:normalizeNickname(profile.nickname),
      playerCode:String(profile.playerCode||generatePlayerCode()).toUpperCase(),
      synced:Boolean(profile.synced),
      createdAt:String(profile.createdAt||now),
      updatedAt:now
    };
    storageSet(PROFILE_KEY,JSON.stringify(clean));
    return clean;
  }

  function isConfigured(){
    return Boolean(
      CONFIG.enabled &&
      /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(String(CONFIG.url||"")) &&
      String(CONFIG.anonKey||"").trim().length>20
    );
  }

  function loadSdk(){
    if(window.supabase?.createClient)return Promise.resolve(window.supabase);
    if(sdkPromise)return sdkPromise;

    sdkPromise=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src=String(CONFIG.sdkUrl||"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3");
      script.async=true;
      script.crossOrigin="anonymous";
      const fail=message=>{
        sdkPromise=null;
        try{script.remove?.();}catch(e){}
        reject(new Error(message));
      };
      script.onload=()=>window.supabase?.createClient
        ? resolve(window.supabase)
        : fail("Supabase SDK yüklenemedi.");
      script.onerror=()=>fail("Supabase SDK indirilemedi.");
      document.head.appendChild(script);
    });

    return sdkPromise;
  }

  async function connect(){
    if(!isConfigured())return null;
    if(client)return client;
    const sdk=await loadSdk();
    client=sdk.createClient(String(CONFIG.url).replace(/\/$/,""),String(CONFIG.anonKey),{
      auth:{
        persistSession:true,
        autoRefreshToken:true,
        detectSessionInUrl:true
      }
    });
    return client;
  }

  async function ensureAnonymousSession(){
    const supabase=await connect();
    if(!supabase)return null;

    const {data:sessionData,error:sessionError}=await supabase.auth.getSession();
    if(sessionError)throw friendlyError(sessionError,"Online oturum kontrol edilemedi.");
    if(sessionData?.session?.user){
      anonymousAuthUnavailable=false;
      return sessionData.session.user;
    }

    /*
     * Anonymous Auth proje tarafında kapalıysa aynı sayfa oturumunda her
     * online işlemde tekrar /signup isteği atmayalım. Ayar sonradan açılırsa
     * sayfa yenilendiğinde devre kesici sıfırlanır ve normal akış yeniden denenir.
     */
    if(anonymousAuthUnavailable){
      throw new Error("Online oturum şu anda kullanılamıyor. Lütfen biraz sonra tekrar dene.");
    }

    const {data,error}=await supabase.auth.signInAnonymously();
    if(error){
      const raw=String(error?.code||error?.message||error||"").toLocaleLowerCase("tr-TR");
      if(
        raw.includes("anonymous_provider_disabled") ||
        raw.includes("anonymous sign-ins are disabled") ||
        raw.includes("anonymous provider is disabled")
      ){
        anonymousAuthUnavailable=true;
      }
      throw friendlyError(error,"Online oturum başlatılamadı.");
    }

    anonymousAuthUnavailable=false;
    return data?.user || data?.session?.user || null;
  }

  async function syncProfile(nickname){
    if(!isConfigured())return null;
    const valid=validateNickname(nickname);
    if(!valid.ok)throw new Error(valid.message);

    await ensureAnonymousSession();
    const supabase=await connect();
    const {data,error}=await supabase.rpc("ensure_profile",{p_nickname:valid.nickname});
    if(error)throw friendlyError(error,"Online profil oluşturulamadı.");

    const row=Array.isArray(data)?data[0]:data;
    if(!row?.player_code)throw new Error("Online profil oluşturulamadı.");

    return persistProfile({
      id:row.id,
      nickname:row.nickname,
      playerCode:row.player_code,
      synced:true,
      createdAt:row.created_at
    });
  }

  async function saveProfile(nickname){
    const valid=validateNickname(nickname);
    if(!valid.ok)throw new Error(valid.message);

    const current=getLocalProfile();
    let local=persistProfile({
      id:current?.id || `local-${Date.now().toString(36)}`,
      nickname:valid.nickname,
      playerCode:current?.playerCode || generatePlayerCode(),
      synced:false,
      createdAt:current?.createdAt
    });

    if(isConfigured()){
      try{
        local=await syncProfile(valid.nickname);
      }catch(error){
        console.warn("Online profil eşitlenemedi:",error);
      }
    }
    return local;
  }

  async function bootstrap(){
    const profile=getLocalProfile();
    if(!profile || !isConfigured())return profile;

    try{
      const user=await ensureAnonymousSession();
      if(!profile.synced || !profile.id || !user?.id || String(profile.id)!==String(user.id)){
        return await syncProfile(profile.nickname);
      }
    }catch(error){
      console.warn("Online profil başlangıç eşitlemesi başarısız:",error);
    }
    return getLocalProfile() || profile;
  }

  async function getPublicProfile(playerCode){
    if(!isConfigured())throw new Error("Online servis yapılandırılmadı.");
    const code=String(playerCode||"").replace(/^#/,"").toUpperCase();
    if(!/^[A-Z2-9]{5}$/.test(code))throw new Error("Geçersiz oyuncu kodu.");

    await ensureAnonymousSession();
    const supabase=await connect();
    const {data,error}=await supabase.rpc("get_public_profile",{p_player_code:code});
    if(error)throw friendlyError(error,"Oyuncu profili alınamadı.");
    return Array.isArray(data)?data[0]||null:data||null;
  }


  async function getHeadToHead(playerCode){
    await ensureSyncedProfile();
    const code=String(playerCode||"").replace(/^#/,"").toUpperCase();
    if(!/^[A-Z2-9]{5}$/.test(code))throw new Error("Geçersiz oyuncu kodu.");
    return rpc("get_head_to_head",{p_player_code:code});
  }

  async function getRecentMatchHistory(limit=50){
    await ensureSyncedProfile();
    const cleanLimit=Math.max(1,Math.min(100,Number(limit)||50));
    const data=await rpc("get_my_recent_match_history",{p_limit:cleanLimit});
    return Array.isArray(data)?data:[];
  }

  function cleanCustomPuzzleCode(value){
    return String(value||"").trim().toUpperCase().replace(/[^A-Z2-9]/g,"").slice(0,7);
  }

  function validateCustomPuzzleCode(value){
    const puzzleCode=cleanCustomPuzzleCode(value);
    return /^[A-Z2-9]{7}$/.test(puzzleCode)
      ? {ok:true,puzzleCode}
      : {ok:false,message:"Özel bulmaca kodu 7 karakter olmalı."};
  }

  async function createCustomPuzzle(mode,length,answer){
    if(!isConfigured())throw new Error("Online servis yapılandırılmadı.");
    const clean=normalizeLiveMode(mode,length);
    const cleanAnswer=String(answer||"").trim().toLocaleUpperCase("tr-TR");
    if(!/^[A-ZÇĞİÖŞÜ]+$/.test(cleanAnswer))throw new Error("Gizli kelime geçersiz.");
    if([...cleanAnswer].length!==clean.length)throw new Error(`${clean.length} harfli bir kelime gir.`);
    await ensureSyncedProfile();
    return rpc("create_custom_puzzle",{p_mode:clean.mode,p_length:clean.length,p_answer:cleanAnswer});
  }

  async function getCustomPuzzle(puzzleCode){
    if(!isConfigured())throw new Error("Online servis yapılandırılmadı.");
    const valid=validateCustomPuzzleCode(puzzleCode);
    if(!valid.ok)throw new Error(valid.message);
    await ensureAnonymousSession();
    return rpc("get_custom_puzzle_state",{p_puzzle_code:valid.puzzleCode});
  }

  async function submitCustomPuzzleGuess(puzzleCode,guess){
    if(!isConfigured())throw new Error("Online servis yapılandırılmadı.");
    const valid=validateCustomPuzzleCode(puzzleCode);
    if(!valid.ok)throw new Error(valid.message);
    const cleanGuess=String(guess||"").trim().toLocaleUpperCase("tr-TR");
    if(!/^[A-ZÇĞİÖŞÜ]+$/.test(cleanGuess))throw new Error("Geçersiz tahmin.");
    await ensureAnonymousSession();
    return rpc("submit_custom_puzzle_guess",{p_puzzle_code:valid.puzzleCode,p_guess:cleanGuess});
  }

  async function useCustomPuzzleHint(puzzleCode){
    if(!isConfigured())throw new Error("Online servis yapılandırılmadı.");
    const valid=validateCustomPuzzleCode(puzzleCode);
    if(!valid.ok)throw new Error(valid.message);
    await ensureAnonymousSession();
    return rpc("use_custom_puzzle_hint",{p_puzzle_code:valid.puzzleCode});
  }

  async function rpc(name,args={}){
    if(!isConfigured())throw new Error("Online servis yapılandırılmadı.");
    await ensureAnonymousSession();
    const supabase=await connect();
    const {data,error}=await supabase.rpc(name,args);
    if(error)throw friendlyError(error);
    return data;
  }

  function cleanRoomCode(value){
    return String(value||"").trim().toUpperCase().replace(/[^A-Z2-9]/g,"").slice(0,6);
  }

  function validateRoomCode(value){
    const roomCode=cleanRoomCode(value);
    return /^[A-Z2-9]{6}$/.test(roomCode)
      ? {ok:true,roomCode}
      : {ok:false,message:"Oda kodu 6 karakter olmalı."};
  }

  function normalizeLiveMode(mode,length){
    const cleanMode=String(mode||"").toLowerCase()==="classic"?"classic":"kelimelik";
    const cleanLength=Number(length);
    if(![4,5,6].includes(cleanLength)){
      throw new Error(`${cleanMode==="classic"?"Klasik":"Kelimelik"} modu için 4, 5 veya 6 harf seç.`);
    }
    return {mode:cleanMode,length:cleanLength};
  }

  async function ensureSyncedProfile(){
    let profile=getLocalProfile();
    if(!profile)throw new Error("Önce oyuncu profili oluştur.");
    if(!isConfigured())throw new Error("Online servis yapılandırılmadı.");

    const user=await ensureAnonymousSession();
    if(!profile.synced || !profile.id || !user?.id || String(profile.id)!==String(user.id)){
      profile=await syncProfile(profile.nickname);
    }
    return profile;
  }

  async function createPrivateMatch(mode,length){
    await ensureSyncedProfile();
    const clean=normalizeLiveMode(mode,length);
    return rpc("create_private_live_match",{p_mode:clean.mode,p_length:clean.length});
  }

  async function joinPrivateMatch(roomCode){
    await ensureSyncedProfile();
    const valid=validateRoomCode(roomCode);
    if(!valid.ok)throw new Error(valid.message);
    return rpc("join_private_live_match",{p_room_code:valid.roomCode});
  }

  async function getLiveMatch(matchId){
    await ensureSyncedProfile();
    const id=String(matchId||"").trim();
    if(!id)throw new Error("Maç kimliği eksik.");
    return rpc("get_live_match_state",{p_match_id:id});
  }

  async function enterQuickMatch(mode,length){
    await ensureSyncedProfile();
    const clean=normalizeLiveMode(mode,length);
    return rpc("enter_quick_match",{p_mode:clean.mode,p_length:clean.length});
  }

  async function pollQuickMatch(){
    await ensureSyncedProfile();
    return rpc("poll_quick_match",{});
  }

  async function cancelQuickMatch(){
    await ensureSyncedProfile();
    return rpc("cancel_quick_match",{});
  }

  function normalizeBotKey(botKey){
    const key=String(botKey||"").trim().toLowerCase();
    return ["efe","defne","atlas"].includes(key)?key:null;
  }

  async function createBotMatch(mode,length,botKey=null){
    await ensureSyncedProfile();
    const clean=normalizeLiveMode(mode,length);
    return rpc("create_bot_match",{p_mode:clean.mode,p_length:clean.length,p_bot_key:normalizeBotKey(botKey)});
  }

  async function advanceBotMatch(matchId){
    await ensureSyncedProfile();
    return rpc("advance_bot_match",{p_match_id:String(matchId||"")});
  }

  async function submitBotGuess(matchId,guess){
    await ensureSyncedProfile();
    const cleanGuess=String(guess||"").trim().toLocaleUpperCase("tr-TR");
    if(!/^[A-ZÇĞİÖŞÜ]+$/.test(cleanGuess))throw new Error("Geçersiz tahmin.");
    return rpc("submit_bot_match_guess",{p_match_id:String(matchId||""),p_guess:cleanGuess});
  }

  async function leaveBotMatch(matchId){
    await ensureSyncedProfile();
    return rpc("leave_bot_match",{p_match_id:String(matchId||"")});
  }

  async function createBotRematch(matchId){
    await ensureSyncedProfile();
    return rpc("create_bot_rematch",{p_match_id:String(matchId||"")});
  }

  async function heartbeatLiveMatch(matchId){
    await ensureSyncedProfile();
    return rpc("heartbeat_live_match",{p_match_id:String(matchId||"")});
  }

  async function submitLiveGuess(matchId,guess){
    await ensureSyncedProfile();
    const cleanGuess=String(guess||"").trim().toLocaleUpperCase("tr-TR");
    if(!/^[A-ZÇĞİÖŞÜ]+$/.test(cleanGuess))throw new Error("Geçersiz tahmin.");
    return rpc("submit_live_guess",{p_match_id:String(matchId||""),p_guess:cleanGuess});
  }

  async function claimDisconnectWin(matchId){
    await ensureSyncedProfile();
    return rpc("claim_live_disconnect_win",{p_match_id:String(matchId||"")});
  }

  async function leaveLiveMatch(matchId){
    await ensureSyncedProfile();
    return rpc("leave_live_match",{p_match_id:String(matchId||"")});
  }

  async function sendLiveReaction(matchId,emoji){
    await ensureSyncedProfile();
    const clean=String(emoji||"");
    if(!["👍","👏","🔥","😅","😮","💀"].includes(clean))throw new Error("Geçersiz tepki.");
    return rpc("send_live_reaction",{p_match_id:String(matchId||""),p_emoji:clean});
  }

  async function requestLiveRematch(matchId){
    await ensureSyncedProfile();
    return rpc("request_live_rematch",{p_match_id:String(matchId||"")});
  }

  async function subscribeLiveMatch(matchId,{onChange,onReaction,onStatus}={}){
    await ensureSyncedProfile();
    const supabase=await connect();
    const id=String(matchId||"");
    if(!id)throw new Error("Maç kimliği eksik.");

    const changed=payload=>{
      try{onChange?.(payload);}catch(error){console.warn("Canlı maç change callback hatası:",error);}
    };
    const reaction=payload=>{
      try{onReaction?.(payload?.new||payload);}catch(error){console.warn("Canlı maç reaction callback hatası:",error);}
    };

    const channel=supabase
      .channel(`kelimelik-live:${id}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"live_matches",filter:`id=eq.${id}`},changed)
      .on("postgres_changes",{event:"*",schema:"public",table:"live_match_players",filter:`match_id=eq.${id}`},changed)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"live_match_guesses",filter:`match_id=eq.${id}`},changed)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"live_match_reactions",filter:`match_id=eq.${id}`},reaction)
      .subscribe(status=>{
        try{onStatus?.(status);}catch(error){console.warn("Canlı maç status callback hatası:",error);}
      });

    return ()=>supabase.removeChannel(channel);
  }

  window.KELIMELIK_ONLINE={
    PROFILE_KEY,
    isConfigured,
    friendlyErrorMessage,
    validateNickname,
    getLocalProfile,
    saveProfile,
    bootstrap,
    getPublicProfile,
    getHeadToHead,
    getRecentMatchHistory,
    cleanCustomPuzzleCode,
    validateCustomPuzzleCode,
    createCustomPuzzle,
    getCustomPuzzle,
    submitCustomPuzzleGuess,
    useCustomPuzzleHint,
    connect,
    cleanRoomCode,
    validateRoomCode,
    createPrivateMatch,
    joinPrivateMatch,
    getLiveMatch,
    enterQuickMatch,
    pollQuickMatch,
    cancelQuickMatch,
    createBotMatch,
    advanceBotMatch,
    submitBotGuess,
    leaveBotMatch,
    createBotRematch,
    heartbeatLiveMatch,
    submitLiveGuess,
    claimDisconnectWin,
    leaveLiveMatch,
    sendLiveReaction,
    requestLiveRematch,
    subscribeLiveMatch
  };
})();
