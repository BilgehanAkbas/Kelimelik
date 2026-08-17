const fs=require("fs");
const path=require("path");
const vm=require("vm");
const assert=require("assert");
const ROOT=path.resolve(__dirname,"..");

async function run(){
  let appendCount=0;
  const localStorage={getItem(){return null;},setItem(){}};
  const window={
    localStorage,
    KELIMELIK_ONLINE_CONFIG:{
      enabled:true,
      url:"https://exampleproject.supabase.co",
      anonKey:"publishable-key-that-is-long-enough-123456789"
    }
  };
  const document={
    createElement(){return {remove(){}};},
    head:{appendChild(script){
      appendCount++;
      if(appendCount===1){
        setTimeout(()=>script.onerror(),0);
        return;
      }
      window.supabase={createClient(){return {marker:"client"};}};
      setTimeout(()=>script.onload(),0);
    }}
  };
  window.window=window;window.document=document;
  const context={window,document,localStorage,console,Date,Math,Uint32Array,Promise,setTimeout,clearTimeout};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT,"src/js/online.js"),"utf8"),context,{filename:"online.js"});

  const api=window.KELIMELIK_ONLINE;
  await assert.rejects(()=>api.connect(),/Supabase SDK indirilemedi/);
  const client=await api.connect();
  assert.strictEqual(client.marker,"client");
  assert.strictEqual(appendCount,2,"başarısız SDK yüklemesinden sonra yeni script denemesi yapılmalı");
  console.log("✓ Supabase SDK geçici yükleme hatasından sonra sayfa yenilemeden retry ediliyor");
}
run().catch(error=>{console.error(error);process.exit(1);});
