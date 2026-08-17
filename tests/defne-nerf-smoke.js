const fs=require('fs');
const path=require('path');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(ROOT,'supabase','migrations','20260816_017_defne_early_game_nerf.sql'),'utf8');

assert(migration.includes("clean_bot='defne' and fail_roll<0.20"));
assert(migration.includes("when 'defne' then 3+floor"));
assert(migration.includes("if lower(p_bot_key)='defne' then"));
assert(migration.includes("when 4 then 1"));
assert(migration.includes("when 4 then 2"));
assert(migration.includes('defne_green_cap'));
assert(migration.includes('<= defne_green_cap'));
assert(migration.includes("when 'defne' then 3.4"));
assert(migration.includes("when 'defne' then 3.2"));
assert(!migration.includes('grant execute on function public.pick_bot_decoy'));
console.log('✓ Defne erken oyun nerfi smoke testi');
