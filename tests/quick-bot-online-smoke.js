const fs=require("fs");
const path=require("path");
const vm=require("vm");
const assert=require("assert");

const ROOT=path.resolve(__dirname,"..");
class Storage{constructor(){this.map=new Map();}getItem(k){return this.map.has(k)?this.map.get(k):null;}setItem(k,v){this.map.set(k,String(v));}}

async function run(){
  const calls=[];
  const client={
    auth:{async getSession(){return {data:{session:{user:{id:"user-1"}}},error:null};},async signInAnonymously(){throw new Error("session var");}},
    async rpc(name,args){
      calls.push({name,args});
      if(name==="ensure_profile")return {data:{id:"user-1",nickname:args.p_nickname,player_code:"K7A2F",created_at:"2026-08-15T20:00:00Z"},error:null};
      if(name==="enter_quick_match")return {data:{status:"waiting",mode:args.p_mode,wordLength:args.p_length},error:null};
      if(name==="poll_quick_match")return {data:{status:"waiting"},error:null};
      if(name==="cancel_quick_match")return {data:{status:"cancelled"},error:null};
      if(name==="create_bot_match")return {data:{id:"bot-1",matchKind:"bot",mode:args.p_mode,wordLength:args.p_length,opponent:{nickname:args.p_bot_key||"Defne"}},error:null};
      if(name==="advance_bot_match")return {data:{id:args.p_match_id,matchKind:"bot",status:"active"},error:null};
      if(name==="submit_bot_match_guess")return {data:{id:args.p_match_id,lastGuess:args.p_guess},error:null};
      if(name==="leave_bot_match")return {data:{id:args.p_match_id,status:"ended"},error:null};
      if(name==="create_bot_rematch")return {data:{id:"bot-2",matchKind:"bot"},error:null};
      return {data:null,error:null};
    }
  };
  const localStorage=new Storage();
  const document={head:{appendChild(){throw new Error("SDK script eklenmemeli");}},createElement(){return {};}};
  const window={localStorage,document,KELIMELIK_ONLINE_CONFIG:{enabled:true,url:"https://exampleproject.supabase.co",anonKey:"publishable-key-that-is-long-enough-123456789"},supabase:{createClient(){return client;}},crypto:{getRandomValues(a){a.fill(9);return a;}}};
  window.window=window;
  const ctx={window,document,localStorage,console,Date,Math,Uint32Array,Promise};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT,"src/js/online.js"),"utf8"),ctx);
  const api=window.KELIMELIK_ONLINE;
  await api.saveProfile("Bilgehan");

  const quick=await api.enterQuickMatch("kelimelik",6);
  assert.strictEqual(quick.status,"waiting");
  assert(calls.some(x=>x.name==="enter_quick_match"&&x.args.p_length===6));
  await api.pollQuickMatch();
  await api.cancelQuickMatch();

  const bot=await api.createBotMatch("classic",6,"atlas");
  assert.strictEqual(bot.matchKind,"bot");
  assert(calls.some(x=>x.name==="create_bot_match"&&x.args.p_mode==="classic"&&x.args.p_length===6&&x.args.p_bot_key==="atlas"));
  await api.advanceBotMatch("bot-1");
  const guessed=await api.submitBotGuess("bot-1"," rüşen ");
  assert.strictEqual(guessed.lastGuess,"RÜŞEN");
  await api.leaveBotMatch("bot-1");
  await api.createBotRematch("bot-1");
  for(const fn of ["advance_bot_match","submit_bot_match_guess","leave_bot_match","create_bot_rematch"]){assert(calls.some(x=>x.name===fn),fn);}
  console.log("✓ Hızlı eşleşme + bot online istemci smoke testi");
}
run().catch(e=>{console.error(e);process.exit(1);});
