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
  let signInCalls=0;
  const localStorage=new Storage();
  const mockClient={
    auth:{
      async getSession(){return {data:{session:null},error:null};},
      async signInAnonymously(){
        signInCalls++;
        return {data:null,error:{code:"anonymous_provider_disabled",message:"Anonymous sign-ins are disabled"}};
      }
    },
    async rpc(){throw new Error("Auth başarısızken RPC çağrılmamalı");}
  };
  const sdk={createClient(){return mockClient;}};
  const document={head:{appendChild(){throw new Error("SDK window'da varken script eklenmemeli");}},createElement(){return {};}};
  const window={
    localStorage,document,supabase:sdk,
    KELIMELIK_ONLINE_CONFIG:{enabled:true,url:"https://example.supabase.co",anonKey:"sb_publishable_123456789012345678901234567890"},
    crypto:{getRandomValues(a){for(let i=0;i<a.length;i++)a[i]=1;return a;}}
  };
  window.window=window;
  const context={window,document,localStorage,console,Date,Math,Uint32Array,Promise,setTimeout,clearTimeout};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT,"src/js/online.js"),"utf8"),context,{filename:"online.js"});
  const api=window.KELIMELIK_ONLINE;

  for(let i=0;i<2;i++){
    await assert.rejects(
      ()=>api.getPublicProfile("ABCDE"),
      /Online oturum şu anda (?:başlatılamıyor|kullanılamıyor)/
    );
  }
  assert.strictEqual(signInCalls,1,"disabled anonymous auth aynı sayfada tekrar tekrar denenmemeli");
  assert.strictEqual(api.friendlyErrorMessage({code:"anonymous_provider_disabled"}),"Online oturum şu anda başlatılamıyor. Lütfen biraz sonra tekrar dene.");
  console.log("✓ Anonymous Auth disabled circuit breaker smoke testi");
}
run().catch(e=>{console.error(e);process.exit(1);});
