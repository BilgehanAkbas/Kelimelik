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
let lastFetchOptions=null;
const cachedConfig={cached:"config"};
const cachedApp={cached:"app"};
const cachedIndex={cached:"index"};

const fakeCache={
  addAll(assets){addedAssets=[...assets];return Promise.resolve();},
  match(request){
    const url=typeof request==="string"?request:String(request?.url||"");
    if(url.includes("online-config.js"))return Promise.resolve(cachedConfig);
    if(url.includes("app.js"))return Promise.resolve(cachedApp);
    if(url.includes("index.html"))return Promise.resolve(cachedIndex);
    return Promise.resolve(undefined);
  },
  put(){return Promise.resolve();}
};

const context={
  console,URL,Promise,Set,Error,
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
      "kelimelik-room-bot-reasoning-final",
      "kelimelik-runtime",
      "another-project-cache"
    ]);},
    delete(name){deleted.push(name);return Promise.resolve(true);}
  },
  fetch(request,options){
    fetchCalls++;
    lastFetchOptions=options||null;
    if(failFetch)return Promise.reject(new Error("offline"));
    return Promise.resolve({ok:true,network:true,clone(){return this;}});
  }
};

vm.createContext(context);
vm.runInContext(code,context,{filename:"sw.js"});
assert(listeners.install && listeners.activate && listeners.fetch);

async function fire(request){
  let response=null;
  listeners.fetch({request,respondWith(x){response=x;}});
  return response ? await response : null;
}

async function run(){
  let p;
  listeners.install({waitUntil(x){p=x;}});
  await p;
  assert.strictEqual(opened,"kelimelik-runtime");
  for(const asset of [
    "./src/css/style.css",
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
  assert(deleted.includes("kelimelik-room-bot-reasoning-final"));
  assert(!deleted.includes("kelimelik-runtime"));
  assert(!deleted.includes("another-project-cache"));
  assert.strictEqual(claimed,true);

  // Critical app code is network-first; no cache-name bump is needed on deploy.
  let before=fetchCalls;
  let result=await fire({method:"GET",url:"https://example.test/Kelimelik/src/js/app.js",mode:"cors"});
  assert.strictEqual(result.network,true);
  assert.strictEqual(fetchCalls,before+1);
  assert.strictEqual(lastFetchOptions.cache,"no-cache");

  failFetch=true;
  result=await fire({method:"GET",url:"https://example.test/Kelimelik/src/js/app.js",mode:"cors"});
  assert.strictEqual(result,cachedApp);
  failFetch=false;

  // online-config is stricter: bypass browser HTTP cache as well.
  before=fetchCalls;
  result=await fire({method:"GET",url:"https://example.test/Kelimelik/src/js/online-config.js",mode:"cors"});
  assert.strictEqual(result.network,true);
  assert.strictEqual(fetchCalls,before+1);
  assert.strictEqual(lastFetchOptions.cache,"no-store");

  failFetch=true;
  result=await fire({method:"GET",url:"https://example.test/Kelimelik/src/js/online-config.js",mode:"cors"});
  assert.strictEqual(result,cachedConfig);

  result=await fire({method:"GET",url:"https://example.test/Kelimelik/oyun",mode:"navigate"});
  assert.strictEqual(result,cachedIndex);
  failFetch=false;

  let intercepted=false;
  listeners.fetch({
    request:{method:"GET",url:"https://example.test/Kelimelik/not-an-asset",mode:"cors"},
    respondWith(){intercepted=true;}
  });
  assert.strictEqual(intercepted,false);

  console.log("✓ Service Worker deploy-safe network-first + offline fallback");
}

run().catch(error=>{console.error(error);process.exit(1);});
