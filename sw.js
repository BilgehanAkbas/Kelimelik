const CACHE_PREFIX="kelimelik-";
/*
 * Stable runtime cache: freshness is request-driven, not release-name-driven.
 * HTML/JS/CSS are network-first, so normal deploys no longer depend on manually
 * changing this cache key. Cached copies remain only as the offline fallback.
 */
const CACHE="kelimelik-runtime";
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
const NETWORK_FIRST_PATHS=new Set([
  "./index.html",
  "./404.html",
  "./src/css/style.css",
  "./src/css/mobile-fixes.css",
  "./src/js/app.js",
  "./src/js/ui-patches.js",
  "./src/js/mobile-fixes.js",
  "./src/js/game-core.js",
  "./src/js/word-pools.js",
  "./src/js/online.js",
  "./manifest.webmanifest",
  "./robots.txt"
].map(asset=>new URL(asset,self.location.href).pathname));
const ONLINE_CONFIG_PATH=new URL("./src/js/online-config.js",self.location.href).pathname;

async function fetchAndCache(request,{cacheMode="no-cache",fallbackKey=null}={}){
  const cache=await caches.open(CACHE);
  try{
    const response=await fetch(request,{cache:cacheMode});
    if(!response || !response.ok){
      throw new Error("network response failed");
    }

    if(fallbackKey){
      await cache.put(fallbackKey,response.clone());
    }else{
      await cache.put(request,response.clone());
    }
    return response;
  }catch(error){
    const cached=await cache.match(
      fallbackKey || request,
      {ignoreSearch:true}
    );
    if(cached)return cached;
    throw error;
  }
}

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
      fetchAndCache(event.request,{
        cacheMode:"no-cache",
        fallbackKey:"./index.html"
      })
    );
    return;
  }

  if(!ASSET_PATHS.has(url.pathname))return;

  if(url.pathname===ONLINE_CONFIG_PATH){
    event.respondWith(
      fetchAndCache(event.request,{cacheMode:"no-store"})
    );
    return;
  }

  if(NETWORK_FIRST_PATHS.has(url.pathname)){
    event.respondWith(
      fetchAndCache(event.request,{cacheMode:"no-cache"})
    );
    return;
  }

  /* Icons/social artwork are safe to keep cache-first; app code is not. */
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
