const fs=require("fs");
const path=require("path");
const vm=require("vm");
const assert=require("assert");
const ROOT=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(ROOT,file),"utf8");

const config=JSON.parse(read("vercel.json"));
const html=read("index.html");
const onlineConfig=read("src/js/online-config.js");
const online=read("src/js/online.js");
const keepalive=read("api/keepalive.js");
const migration=read("supabase/migrations/20261103_033_keepalive_rate_limits.sql");
const ignored=read(".vercelignore").split(/\r?\n/);

const context={window:{}};
vm.runInNewContext(onlineConfig,context);
const online_config=context.window.KELIMELIK_ONLINE_CONFIG;
const host=new URL(online_config.url).host;

// SDK bütünlüğü ve oturum güvenliği
assert(/^sha384-[A-Za-z0-9+/]+=*$/.test(online_config.sdkIntegrity));
assert(online.includes("script.integrity=String(CONFIG.sdkIntegrity)"));
assert(online.includes("detectSessionInUrl:false"));

// CSP yalnız kullanılan SDK dosyasına ve bu Supabase projesine izin verir
const headerCsp=config.headers.flatMap(x=>x.headers||[]).find(x=>x.key==="Content-Security-Policy").value;
for(const csp of [headerCsp,html]){
  assert(csp.includes(`script-src 'self' ${online_config.sdkUrl};`));
  assert(csp.includes(`https://${host} wss://${host};`));
  assert(!csp.includes("*.supabase.co"));
}

// Test ve SQL dosyaları yayına çıkmaz; gereken dosyalar çıkar
for(const entry of ["tests","supabase",".github"])assert(ignored.includes(entry));
for(const entry of ["api","src","assets","licenses"])assert(!ignored.includes(entry));

// Keep-alive günlük çalışır ve yalnız tarayıcıya açık değerleri kullanır
assert(config.crons.some(x=>x.path==="/api/keepalive" && x.schedule==="0 6 * * *"));
assert(keepalive.includes(`"${online_config.url}"`));
assert(keepalive.includes(`"${online_config.anonKey}"`));
assert(!/service_role\s*[:=]/i.test(keepalive));
assert(!/eyJ[A-Za-z0-9_-]{20,}/.test(keepalive));
assert(keepalive.includes("rpc/keepalive_ping"));

// Migration: ping yalnız anon, tetikleyici fonksiyonu kimseye açık değil
assert(migration.includes("grant execute on function public.keepalive_ping() to anon;"));
assert(migration.includes("revoke all on function public.enforce_creation_rate_limit() from public, anon, authenticated;"));
for(const table of ["custom_puzzles","live_matches","bot_matches"]){
  assert(migration.includes(`before insert on public.${table}`));
}
assert(online.includes('"Çok fazla "'));
assert(migration.includes("aw.answer_version=''A3''"));

console.log("✓ SDK SRI, dar CSP, yayın dışı dosyalar, keep-alive ve hız sınırı smoke testi");
