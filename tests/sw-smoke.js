const fs=require("fs");
const path=require("path");
const vm=require("vm");
const assert=require("assert");

const ROOT=path.resolve(__dirname,"..");
const code=fs.readFileSync(path.join(ROOT,"sw.js"),"utf8");
const listeners={};
const deleted=[];
let opened=null;
let addedAssets=[];
let skipped=false;
let claimed=false;
let fetchCalls=0;
let failFetch=false;
const cachedConfig={cached:true};

const fakeCache={
  addAll(assets){addedAssets=[...assets];return Promise.resolve();},
  match(request){
    const url=typeof request==="string"?request:String(request?.url||"");
    if(url.includes("online-config.js"))return Promise.resolve(cachedConfig);
    return Promise.resolve(undefined);
  },
  put(){return Promise.resolve();}
};

const context={
  console,URL,Promise,Set,
  self:{
    location:{href:"https://example.test/Kelimelik/sw.js",origin:"https://example.test"},
    addEventListener(name,handler){listeners[name]=handler;},
    skipWaiting(){skipped=true;return Promise.resolve();},
    clients:{claim(){claimed=true;return Promise.resolve();}}
  },
  caches:{
    open(name){opened=name;return Promise.resolve(fakeCache);},
    keys(){return Promise.resolve([
      "kelimelik-v1.2.36-modal-close-align",
      "kelimelik-ui-stable",
      "kelimelik-mobile-online-bot-final",
      "kelimelik-room-bot-reasoning-final",
      "another-project-cache"
    ]);},
    delete(name){deleted.push(name);return Promise.resolve(true);}
  },
  fetch(request){
    fetchCalls++;
    if(failFetch)return Promise.reject(new Error("offline"));
    return Promise.resolve({ok:true,network:true,clone(){return this;}});
  }
};

vm.createContext(context);
vm.runInContext(code,context,{filename:"sw.js"});
assert(listeners.install && listeners.activate && listeners.fetch);

async function run(){
  let p;
  listeners.install({waitUntil(x){p=x;}});
  await p;
  assert.strictEqual(opened,"kelimelik-room-bot-reasoning-final");
  for(const asset of [
    "./src/css/mobile-fixes.css",
    "./src/js/mobile-fixes.js",
    "./src/js/app.js",
    "./src/js/online-config.js"
  ]) assert(addedAssets.includes(asset),`cache asset eksik: ${asset}`);
  assert.strictEqual(skipped,true);

  listeners.activate({waitUntil(x){p=x;}});
  await p;
  assert(deleted.includes("kelimelik-v1.2.36-modal-close-align"));
  assert(deleted.includes("kelimelik-ui-stable"));
  assert(deleted.includes("kelimelik-mobile-online-bot-final"));
  assert(!deleted.includes("kelimelik-room-bot-reasoning-final"));
  assert(!deleted.includes("another-project-cache"));
  assert.strictEqual(claimed,true);

  let response=null;
  const before=fetchCalls;
  listeners.fetch({
    request:{method:"GET",url:"https://example.test/Kelimelik/src/js/online-config.js",mode:"cors"},
    respondWith(x){response=x;}
  });
  assert(response);
  const network=await response;
  assert.strictEqual(network.network,true);
  assert.strictEqual(fetchCalls,before+1);

  failFetch=true;
  response=null;
  listeners.fetch({
    request:{method:"GET",url:"https://example.test/Kelimelik/src/js/online-config.js",mode:"cors"},
    respondWith(x){response=x;}
  });
  assert.strictEqual(await response,cachedConfig);
  failFetch=false;

  let intercepted=false;
  listeners.fetch({
    request:{method:"GET",url:"https://example.test/Kelimelik/not-an-asset",mode:"cors"},
    respondWith(){intercepted=true;}
  });
  assert.strictEqual(intercepted,false);

  console.log("✓ Service Worker final cache, cleanup ve online-config davranışı");
}

run().catch(error=>{console.error(error);process.exit(1);});
