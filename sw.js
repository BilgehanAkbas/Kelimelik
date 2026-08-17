const CACHE_PREFIX="kelimelik-";
// mobile header sizing + fixed online modal close + UI asset refresh
// legacy-ci-marker: const CACHE="kelimelik-v1.2.36-modal-close-align"
const CACHE="kelimelik-ui-stable";
const ASSETS=[
  "./",
  "./index.html",
  "./404.html",
  "./src/css/style.css",
  "./src/css/mobile-fixes.css",
  "./src/js/app.js",
  "./src/js/ui-patches.js",
  "./src/js/mobile-fixes.js",
  "./src/js/game-core.js",
  "./src/js/word-pools.js",
  "./src/js/online-config.js",
  "./src/js/online.js",
  "./manifest.webmanifest",
  "./assets/favicon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/social-card.png",
  "./robots.txt"
];

const ASSET_PATHS=new Set(
  ASSETS.map(asset=>new URL(asset,self.location.href).pathname)
);
const ONLINE_CONFIG_PATH=new URL("./src/js/online-config.js",self.location.href).pathname;

self.addEventListener("install",event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>cache.addAll(ASSETS))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(
        keys
          .filter(key=>key.startsWith(CACHE_PREFIX) && key!==CACHE)
          .map(key=>caches.delete(key))
      ))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;

  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;

  if(event.request.mode==="navigate"){
    event.respondWith(
      fetch(event.request).catch(()=>
        caches.open(CACHE).then(cache=>cache.match("./index.html"))
      )
    );
    return;
  }

  if(!ASSET_PATHS.has(url.pathname))return;

  if(url.pathname===ONLINE_CONFIG_PATH){
    event.respondWith(
      caches.open(CACHE).then(cache=>
        fetch(event.request,{cache:"no-store"}).then(response=>{
          if(!response || !response.ok){
            throw new Error("online-config network response failed");
          }
          cache.put(event.request,response.clone());
          return response;
        }).catch(()=>cache.match(event.request,{ignoreSearch:true}))
      )
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(cache=>
      cache.match(event.request,{ignoreSearch:true}).then(cached=>{
        if(cached)return cached;

        return fetch(event.request).then(response=>{
          if(response && response.ok){
            cache.put(event.request,response.clone());
          }
          return response;
        });
      })
    )
  );
});
