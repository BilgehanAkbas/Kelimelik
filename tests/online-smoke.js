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
  const localStorage=new Storage();
  const document={
    head:{appendChild(){throw new Error("SDK disabled iken yüklenmemeli");}},
    createElement(){return {};}
  };
  const window={
    localStorage,
    document,
    KELIMELIK_ONLINE_CONFIG:{enabled:false,url:"",anonKey:""},
    crypto:{
      getRandomValues(array){
        for(let i=0;i<array.length;i++)array[i]=100+i;
        return array;
      }
    }
  };
  window.window=window;

  const context={window,document,localStorage,console,Date,Math,Uint32Array,Promise,setTimeout,clearTimeout};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT,"src/js/online.js"),"utf8"),context,{filename:"online.js"});

  const api=window.KELIMELIK_ONLINE;
  assert(api);
  assert.strictEqual(api.isConfigured(),false);
  assert.strictEqual(api.getLocalProfile(),null);
  assert.strictEqual(api.validateNickname("A").ok,false);
  assert.strictEqual(api.validateNickname("Bilgehan").ok,true);
  assert.strictEqual(api.validateNickname("<script>").ok,false);

  const profile=await api.saveProfile("  Bilgehan   Akbaş  ");
  assert.strictEqual(profile.nickname,"Bilgehan Akbaş");
  assert(/^[A-Z2-9]{5}$/.test(profile.playerCode));
  assert.strictEqual(profile.synced,false);

  const restored=api.getLocalProfile();
  assert.strictEqual(restored.nickname,"Bilgehan Akbaş");
  assert.strictEqual(restored.playerCode,profile.playerCode);

  const edited=await api.saveProfile("Bilgehan");
  assert.strictEqual(edited.playerCode,profile.playerCode);
  assert.strictEqual(edited.nickname,"Bilgehan");

  console.log("Online profil smoke test geçti.");
}

run().catch(error=>{
  console.error(error);
  process.exit(1);
});
