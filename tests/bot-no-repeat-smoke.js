const fs=require('fs');
const path=require('path');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(ROOT,'supabase','migrations','20260816_019_bot_no_repeat.sql'),'utf8');

assert(sql.includes('create or replace function public.pick_bot_decoy'));
assert(!/chosen\s*:=\s*latest_guess/i.test(sql),'son tahmini tekrar kullanan fallback geri gelmiş');
assert(!/select\s+g\.guess_word\s+into\s+latest_guess/i.test(sql),'latest_guess tekrar fallbacki geri gelmiş');
const usedExclusions=(sql.match(/used\.guess_word=w\.word/g)||[]).length;
assert(usedExclusions>=4,'tüm fallback aşamalarında kullanılmış tahminler dışlanmalı');
assert(sql.includes("raise exception 'Bot için yeni tahmin bulunamadı'"));
console.log('✓ Bot aynı kelimeyi tekrar kullanmıyor smoke testi');
