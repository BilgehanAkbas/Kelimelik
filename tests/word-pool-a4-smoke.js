const fs=require("fs");
const path=require("path");
const vm=require("vm");
const assert=require("assert");

const ROOT=path.resolve(__dirname,"..");
const ctx={window:{}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT,"src/js/word-pools.js"),"utf8"),ctx,{filename:"word-pools.js"});

const words=ctx.window.KELIMELIK_WORD_POOLS;
const pools=ctx.window.KELIMELIK_ANSWER_POOLS;
const daily=ctx.window.KELIMELIK_DAILY_SERIES[0];
const sql=fs.readFileSync(path.join(ROOT,"supabase/migrations/20261103_034_word_pool_cleanup_a4.sql"),"utf8");

// A4 boyutu, biçimi ve tahmin havuzuyla tutarlılığı
assert.deepStrictEqual([pools.A4["4"].length,pools.A4["5"].length,pools.A4["6"].length],[766,1041,584]);
for(const length of ["4","5","6"]){
  const guess=new Set(words[length]);
  assert.strictEqual(guess.size,words[length].length,`${length} harf tahmin havuzunda tekrar var`);
  assert.strictEqual(new Set(pools.A4[length]).size,pools.A4[length].length,`${length} harf A4'te tekrar var`);
  for(const word of words[length]){
    assert(/^[A-ZÇĞİÖŞÜ]+$/.test(word) && [...word].length===Number(length),`${word} biçimi hatalı`);
  }
  for(const word of pools.A4[length])assert(guess.has(word),`${word} A4'te var, tahmin havuzunda yok`);
  // Eski oyun kodları için dondurulmuş cevaplar havuzdan çıkmaz
  for(const version of ["A1","A2","A3"]){
    for(const word of pools[version][length])assert(guess.has(word),`${word} ${version} için havuzda kalmalı`);
  }
}
for(const word of daily.answers)assert(words["5"].includes(word),`${word} günlük seri için havuzda kalmalı`);

// Dondurulmuş sürümler değişmez
assert.deepStrictEqual([pools.A1["4"].length,pools.A1["5"].length,pools.A1["6"].length],[156,659,114]);
assert.deepStrictEqual([pools.A2["4"].length,pools.A2["5"].length,pools.A2["6"].length],[596,790,195]);
assert.deepStrictEqual([pools.A3["4"].length,pools.A3["5"].length,pools.A3["6"].length],[591,787,189]);
assert.strictEqual(daily.answers.length,659);

// TDK'da bulunmayan yanlış yazımlar çıkar, eksik kelimeler ve bilinçli istisnalar kalır
for(const word of ["ACIK","BAZAN","BAKİM","CEHİT","FAKIR","RİTM","LOĞUSA","MENTOR","SİLUET","VAGİNA"]){
  assert(!words[String([...word].length)].includes(word),`${word} havuzdan çıkmalı`);
  assert(sql.includes(`(${[...word].length},'${word}')`),`${word} veritabanı temizliğinde yok`);
}
for(const word of ["BÖRÜ","SPAM","EMOJİ","BULAŞ","KİNOA","HOSTEL","MUTANT","UNVAN","İKEN","HALİL","MEHMET"]){
  assert(words[String([...word].length)].includes(word),`${word} havuzda olmalı`);
}

// Yeni oyun cevapları: çekimli biçimler yok, sık kelimeler var
for(const word of ["OLDU","OLUR","OLMAZ","BAĞI","DÜZE","KÖRE","BURADA","BURASI","ÇIKAR","DÜŞÜN","NEREYE","ONLAR","GÖLÜ","ARANAN","EKRANI"]){
  assert(!pools.A4[String([...word].length)].includes(word),`${word} A4'te olmamalı`);
}
for(const word of ["UMUT","RÜYA","BAHÇE","EKMEK","KARDEŞ","TOPRAK","ZEYTİN","KOKU"]){
  assert(pools.A4[String([...word].length)].includes(word),`${word} A4'te olmalı`);
  assert(sql.includes(`'${word}'`) || pools.A3[String([...word].length)].includes(word),`${word} online havuzda yok`);
}

console.log("✓ TDK 2026 tahmin havuzu ve A4 cevap listesi tutarlı, eski sürümler korunuyor");
