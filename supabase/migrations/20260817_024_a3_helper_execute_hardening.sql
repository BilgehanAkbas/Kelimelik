-- Kelimelik A3 helper privilege hardening.
-- Trigger/helper fonksiyonları doğrudan REST/RPC çağrısına açık olmamalıdır.
-- Triggerlar bu EXECUTE grantlerine ihtiyaç duymadan çalışmaya devam eder.

revoke all on function public.pick_fresh_multiplayer_answer(integer, uuid[], text)
from public, anon, authenticated;

revoke all on function public.enforce_fresh_live_answer_a3()
from public, anon, authenticated;

revoke all on function public.enforce_fresh_bot_answer_a3()
from public, anon, authenticated;
