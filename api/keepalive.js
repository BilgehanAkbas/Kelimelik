/*
 * Vercel Cron bu adresi günde bir kez çağırır. Ücretsiz Supabase projesi 7 gün
 * etkinlik görmezse duraklatıldığı için veritabanına tek ve zararsız bir sorgu
 * gönderilir. Buradaki değerler tarayıcıya açık online-config.js ile aynıdır.
 * service_role / secret key KESİNLİKLE buraya yazılmamalıdır.
 */
const SUPABASE_URL="https://ggezbkgqgzghygltqqsb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_cI_bZXFv4xs-iRU1h-yg-w_7HWu0HW3";

module.exports=async function keepalive(req,res){
  res.setHeader("Cache-Control","no-store");

  /* CRON_SECRET tanımlıysa Vercel Cron bunu Authorization başlığında gönderir. */
  const secret=process.env.CRON_SECRET;
  if(secret && req.headers.authorization!==`Bearer ${secret}`){
    res.statusCode=401;
    res.end(JSON.stringify({ok:false}));
    return;
  }

  let ok=false;
  try{
    const response=await fetch(`${SUPABASE_URL}/rest/v1/rpc/keepalive_ping`,{
      method:"POST",
      headers:{apikey:SUPABASE_PUBLISHABLE_KEY,"Content-Type":"application/json"},
      body:"{}",
      signal:AbortSignal.timeout(10000)
    });
    ok=response.ok;
    if(!ok)console.error("Supabase keep-alive başarısız:",response.status);
  }catch(error){
    console.error("Supabase keep-alive başarısız:",error?.message||error);
  }

  res.statusCode=ok?200:503;
  res.setHeader("Content-Type","application/json");
  res.end(JSON.stringify({ok}));
};
