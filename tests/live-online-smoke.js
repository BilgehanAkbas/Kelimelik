const fs=require("fs");
const path=require("path");
const vm=require("vm");
const assert=require("assert");

const ROOT=path.resolve(__dirname,"..");

class Storage{
  constructor(){this.map=new Map();}
  getItem(key){return this.map.has(key)?this.map.get(key):null;}
  setItem(key,value){this.map.set(key,String(value));}
  removeItem(key){this.map.delete(key);}
}

async function run(){
  const calls=[];
  const handlers=[];
  let removedChannel=false;
  const channel={
    on(type,filter,handler){handlers.push({type,filter,handler});return this;},
    subscribe(cb){this.statusCb=cb;cb("SUBSCRIBED");return this;}
  };
  const client={
    auth:{
      async getSession(){return {data:{session:{user:{id:"user-1"}}},error:null};},
      async signInAnonymously(){throw new Error("mevcut session varken çağrılmamalı");}
    },
    async rpc(name,args){
      calls.push({name,args});
      if(name==="ensure_profile")return {data:{id:"user-1",nickname:args.p_nickname,player_code:"K7A2F",created_at:"2026-08-15T20:00:00Z"},error:null};
      if(name==="create_private_live_match")return {data:{id:"match-1",roomCode:"A4C9F2",mode:args.p_mode,wordLength:args.p_length},error:null};
      if(name==="join_private_live_match")return {data:{id:"match-1",roomCode:args.p_room_code},error:null};
      if(name==="submit_live_guess")return {data:{id:"match-1",lastGuess:args.p_guess},error:null};
      return {data:{id:"match-1"},error:null};
    },
    channel(name){calls.push({name:"channel",args:{name}});return channel;},
    async removeChannel(ch){assert.strictEqual(ch,channel);removedChannel=true;}
  };
  const localStorage=new Storage();
  const document={
    head:{appendChild(){throw new Error("SDK zaten hazırken script eklenmemeli");}},
    createElement(){return {};}
  };
  const window={
    localStorage,
    document,
    KELIMELIK_ONLINE_CONFIG:{enabled:true,url:"https://exampleproject.supabase.co",anonKey:"publishable-key-that-is-long-enough-123456789"},
    supabase:{createClient(){return client;}},
    crypto:{getRandomValues(array){for(let i=0;i<array.length;i++)array[i]=100+i;return array;}}
  };
  window.window=window;
  const context={window,document,localStorage,console,Date,Math,Uint32Array,Promise,setTimeout,clearTimeout};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT,"src/js/online.js"),"utf8"),context,{filename:"online.js"});

  const api=window.KELIMELIK_ONLINE;
  assert(api.isConfigured());
  assert.strictEqual(api.friendlyErrorMessage({code:"P0001",message:"Kelime havuzunda yok"}),"Kelime havuzunda yok");
  assert.strictEqual(api.friendlyErrorMessage({code:"P0001",message:"Çok hızlı tepki gönderiyorsun"}),"Çok hızlı tepki gönderiyorsun");
  const profile=await api.saveProfile("Bilgehan");
  assert.strictEqual(profile.synced,true);
  assert.strictEqual(profile.playerCode,"K7A2F");

  const created=await api.createPrivateMatch("kelimelik",5);
  assert.strictEqual(created.roomCode,"A4C9F2");
  assert(calls.some(x=>x.name==="create_private_live_match" && x.args.p_mode==="kelimelik" && x.args.p_length===5));

  const classic=await api.createPrivateMatch("classic",6);
  assert(calls.some(x=>x.name==="create_private_live_match" && x.args.p_mode==="classic" && x.args.p_length===6));
  assert.strictEqual(classic.wordLength,6);

  assert.strictEqual(api.cleanRoomCode(" a4-c9 f2 "),"A4C9F2");
  assert.strictEqual(api.validateRoomCode("A4C9F2").ok,true);
  assert.strictEqual(api.validateRoomCode("XYZ").ok,false);
  await api.joinPrivateMatch("a4c9f2");
  assert(calls.some(x=>x.name==="join_private_live_match" && x.args.p_room_code==="A4C9F2"));

  const submitted=await api.submitLiveGuess("match-1"," rüşen ");
  assert.strictEqual(submitted.lastGuess,"RÜŞEN");
  assert(calls.some(x=>x.name==="submit_live_guess" && x.args.p_guess==="RÜŞEN"));

  await api.heartbeatLiveMatch("match-1");
  await api.claimDisconnectWin("match-1");
  await api.sendLiveReaction("match-1","🔥");
  await api.requestLiveRematch("match-1");
  assert(calls.some(x=>x.name==="heartbeat_live_match"));
  assert(calls.some(x=>x.name==="claim_live_disconnect_win"));
  assert(calls.some(x=>x.name==="send_live_reaction" && x.args.p_emoji==="🔥"));
  assert(calls.some(x=>x.name==="request_live_rematch"));

  let changeCount=0,reactionCount=0,status="";
  const unsubscribe=await api.subscribeLiveMatch("match-1",{
    onChange(){changeCount++;},
    onReaction(){reactionCount++;},
    onStatus(value){status=value;}
  });
  assert.strictEqual(status,"SUBSCRIBED");
  assert.strictEqual(handlers.length,4);
  const guessHandler=handlers.find(x=>x.filter.table==="live_match_guesses");
  const reactionHandler=handlers.find(x=>x.filter.table==="live_match_reactions");
  guessHandler.handler({new:{}});
  reactionHandler.handler({new:{emoji:"👏"}});
  assert.strictEqual(changeCount,1);
  assert.strictEqual(reactionCount,1);
  await unsubscribe();
  assert.strictEqual(removedChannel,true);

  console.log("✓ Canlı oda online istemci RPC + Realtime smoke testi");
}

run().catch(error=>{console.error(error);process.exit(1);});
