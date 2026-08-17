const fs=require('fs');
const path=require('path');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(ROOT,'supabase','migrations','20260816_016_bot_progressive_guessing.sql'),'utf8');
const app=fs.readFileSync(path.join(ROOT,'src','js','app.js'),'utf8');
const css=fs.readFileSync(path.join(ROOT,'src','css','style.css'),'utf8');
const index=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');

assert(migration.includes('create or replace function public.pick_bot_decoy'));
assert(migration.includes("when match_mode='classic'"));
assert(migration.includes("prior.feedback->'pattern'"));
assert(migration.includes("max_green"));
assert(migration.includes("max_present"));
assert(migration.includes("chosen:=latest_guess"));
assert(!migration.includes('grant execute on function public.pick_bot_decoy'));

assert(index.includes('id="modalClose" type="button"'));
assert(app.includes('modalCloseButton.onclick=e=>'));
assert(app.includes('e?.stopPropagation?.()'));
assert(css.includes('z-index:100!important'));
assert(css.includes('pointer-events:auto!important'));
assert(css.includes('touch-action:manipulation'));

console.log('✓ Bot ilerleme mantığı ve modal X tıklama alanı smoke testi');
