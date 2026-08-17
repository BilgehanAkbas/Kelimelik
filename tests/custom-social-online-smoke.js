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
      if(name==="create_custom_puzzle")return {data:{puzzleCode:"X82KF9Q",mode:args.p_mode,wordLength:args.p_length,attemptLimit:args.p_mode==="classic"?(args.p_length+1):8},error:null};
      if(name==="get_custom_puzzle_state")return {data:{puzzleCode:args.p_puzzle_code,status:"active",mode:"kelimelik",wordLength:5,attemptLimit:8,guesses:[]},error:null};
      if(name==="submit_custom_puzzle_guess")return {data:{puzzleCode:args.p_puzzle_code,status:"active",lastGuess:args.p_guess,hintUsed:false},error:null};
      if(name==="use_custom_puzzle_hint")return {data:{puzzleCode:args.p_puzzle_code,status:"active",hintUsed:true,guesses:[{guessWord:"KALEM"}]},error:null};
      if(name==="get_head_to_head")return {data:{opponentPlayerCode:args.p_player_code,totalMatches:7,myWins:4,opponentWins:3,draws:0,lastFive:[]},error:null};
      return {data:null,error:null};
    }
  };
  const localStorage=new Storage();
  const document={head:{appendChild(){throw new Error("SDK script eklenmemeli");}},createElement(){return {};}};
  const window={localStorage,document,KELIMELIK_ONLINE_CONFIG:{enabled:true,url:"https://exampleproject.supabase.co",anonKey:"publishable-key-that-is-long-enough-123456789"},supabase:{createClient(){return client;}},crypto:{getRandomValues(a){a.fill(11);return a;}}};
  window.window=window;
  const ctx={window,document,localStorage,console,Date,Math,Uint32Array,Promise};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT,"src/js/online.js"),"utf8"),ctx);
  const api=window.KELIMELIK_ONLINE;

  assert.strictEqual(api.validateCustomPuzzleCode("x82kf9q").puzzleCode,"X82KF9Q");
  await api.saveProfile("Bilgehan");
  const created=await api.createCustomPuzzle("classic",6," mehmet ");
  assert.strictEqual(created.puzzleCode,"X82KF9Q");
  assert(calls.some(x=>x.name==="create_custom_puzzle"&&x.args.p_mode==="classic"&&x.args.p_length===6&&x.args.p_answer==="MEHMET"));
  await api.getCustomPuzzle("X82KF9Q");
  const guessed=await api.submitCustomPuzzleGuess("X82KF9Q"," kalem ");
  assert.strictEqual(guessed.lastGuess,"KALEM");
  const hinted=await api.useCustomPuzzleHint("X82KF9Q");
  assert.strictEqual(hinted.hintUsed,true);
  assert(calls.some(x=>x.name==="use_custom_puzzle_hint"));

  const h2h=await api.getHeadToHead("M92QD");
  assert.strictEqual(h2h.totalMatches,7);
  assert(calls.some(x=>x.name==="get_head_to_head"&&x.args.p_player_code==="M92QD"));
  console.log("✓ Özel bulmaca + public sosyal istemci smoke testi");
}
run().catch(e=>{console.error(e);process.exit(1);});
