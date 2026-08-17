const fs=require("fs");
const path=require("path");
const vm=require("vm");
const assert=require("assert");
const ROOT=path.resolve(__dirname,"..");

class Storage{
  constructor(){this.map=new Map();}
  getItem(k){return this.map.has(k)?this.map.get(k):null;}
  setItem(k,v){this.map.set(k,String(v));}
  removeItem(k){this.map.delete(k);}
}

async function run(){
  let currentUserId="user-1";
  const calls=[];
  const client={
    auth:{
      async getSession(){return {data:{session:{user:{id:currentUserId}}},error:null};},
      async signInAnonymously(){return {data:{user:{id:currentUserId},session:{user:{id:currentUserId}}},error:null};}
    },
    async rpc(name,args){
      calls.push({name,args,user:currentUserId});
      if(name==="ensure_profile")return {data:{id:currentUserId,nickname:args.p_nickname,player_code:currentUserId==="user-1"?"K7A2F":"M92QD",created_at:"2026-08-16T00:00:00Z"},error:null};
      if(name==="create_private_live_match")return {data:{id:"match-1",roomCode:"A4C9F2",mode:args.p_mode,wordLength:args.p_length},error:null};
      return {data:{},error:null};
    }
  };
  const localStorage=new Storage();
  const document={head:{appendChild(){throw new Error("SDK zaten hazır");}},createElement(){return {};}};
  const window={localStorage,document,KELIMELIK_ONLINE_CONFIG:{enabled:true,url:"https://exampleproject.supabase.co",anonKey:"publishable-key-that-is-long-enough-123456789"},supabase:{createClient(){return client;}},crypto:{getRandomValues(a){a.fill(9);return a;}}};
  window.window=window;
  const ctx={window,document,localStorage,console,Date,Math,Uint32Array,Promise};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT,"src/js/online.js"),"utf8"),ctx,{filename:"online.js"});
  const api=window.KELIMELIK_ONLINE;

  const first=await api.saveProfile("Bilgehan");
  assert.strictEqual(first.id,"user-1");
  assert.strictEqual(first.playerCode,"K7A2F");

  // Supabase oturumu başka anonymous user'a dönerse local synced flag'e güvenilmemeli.
  currentUserId="user-2";
  await api.createPrivateMatch("kelimelik",5);
  const repaired=api.getLocalProfile();
  assert.strictEqual(repaired.id,"user-2");
  assert.strictEqual(repaired.playerCode,"M92QD");
  assert(calls.some(x=>x.name==="ensure_profile"&&x.user==="user-2"));
  assert(calls.some(x=>x.name==="create_private_live_match"&&x.user==="user-2"));

  console.log("✓ Supabase oturumu değişince synced profil otomatik onarılıyor");
}
run().catch(e=>{console.error(e);process.exit(1);});
