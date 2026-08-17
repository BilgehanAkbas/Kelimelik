-- Kelimelik Online v1.2.3 — Özel bulmaca + public rakip profili + ikili geçmiş
-- 2026-08-15
-- 001 → 002 → 003 → 004 sonrasında çalıştırılmalıdır.

create table if not exists public.custom_puzzles (
  id uuid primary key default gen_random_uuid(),
  puzzle_code text not null unique check (puzzle_code ~ '^[A-Z2-9]{7}$'),
  creator_id uuid references auth.users(id) on delete set null,
  mode text not null check (mode in ('kelimelik','classic')),
  word_length smallint not null check (word_length in (4,5,6)),
  attempt_limit smallint not null check (attempt_limit in (5,6,7,8)),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '90 days'),
  check (
    (mode='classic' and word_length in (4,5,6) and attempt_limit=word_length+1)
    or
    (mode='kelimelik' and word_length in (4,5,6) and attempt_limit=8)
  )
);

-- Gizli cevap ayrı tabloda tutulur ve istemciye SELECT verilmez.
create table if not exists public.custom_puzzle_secrets (
  puzzle_id uuid primary key references public.custom_puzzles(id) on delete cascade,
  answer_word text not null check (answer_word ~ '^[A-ZÇĞİÖŞÜ]+$'),
  created_at timestamptz not null default now()
);

create table if not exists public.custom_puzzle_plays (
  id uuid primary key default gen_random_uuid(),
  puzzle_id uuid not null references public.custom_puzzles(id) on delete cascade,
  player_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','ended')),
  attempts_used smallint not null default 0 check (attempts_used between 0 and 8),
  won boolean not null default false,
  hint_used boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (puzzle_id,player_id)
);

create table if not exists public.custom_puzzle_guesses (
  id bigint generated always as identity primary key,
  play_id uuid not null references public.custom_puzzle_plays(id) on delete cascade,
  guess_no smallint not null check (guess_no between 1 and 8),
  guess_word text not null check (guess_word ~ '^[A-ZÇĞİÖŞÜ]+$'),
  feedback jsonb not null,
  solved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (play_id,guess_no)
);

alter table public.custom_puzzles enable row level security;
alter table public.custom_puzzle_secrets enable row level security;
alter table public.custom_puzzle_plays enable row level security;
alter table public.custom_puzzle_guesses enable row level security;

revoke all on public.custom_puzzles from anon, authenticated;
revoke all on public.custom_puzzle_secrets from anon, authenticated;
revoke all on public.custom_puzzle_plays from anon, authenticated;
revoke all on public.custom_puzzle_guesses from anon, authenticated;

create or replace function public.make_custom_puzzle_code()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  i integer;
begin
  for attempt in 1..120 loop
    candidate := '';
    for i in 1..7 loop
      candidate := candidate || substr(alphabet,1+floor(random()*length(alphabet))::integer,1);
    end loop;
    if not exists(select 1 from public.custom_puzzles p where p.puzzle_code=candidate) then
      return candidate;
    end if;
  end loop;
  raise exception 'Özel bulmaca kodu üretilemedi';
end;
$$;

create or replace function public.create_custom_puzzle(p_mode text,p_length integer,p_answer text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_mode text := lower(btrim(coalesce(p_mode,'')));
  clean_length integer := p_length;
  attempts integer;
  answer text := upper(btrim(coalesce(p_answer,'')));
  new_id uuid := gen_random_uuid();
  code text;
  expires timestamptz := clock_timestamp()+interval '90 days';
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;

  if clean_mode='classic' and clean_length in (4,5,6) then
    attempts:=clean_length+1;
  elsif clean_mode='kelimelik' and clean_length in (4,5,6) then
    attempts:=8;
  else
    raise exception 'Geçersiz oyun modu';
  end if;

  if char_length(answer)<>clean_length or answer !~ '^[A-ZÇĞİÖŞÜ]+$' then
    raise exception 'Gizli kelime seçilen harf sayısıyla uyumlu değil';
  end if;

  if not exists(
    select 1 from public.multiplayer_guess_words w
    where w.length=clean_length and w.word=answer
  ) then
    raise exception 'Bu kelime Kelimelik tahmin sözlüğünde bulunmuyor';
  end if;

  code:=public.make_custom_puzzle_code();

  insert into public.custom_puzzles(id,puzzle_code,creator_id,mode,word_length,attempt_limit,expires_at)
  values(new_id,code,uid,clean_mode,clean_length,attempts,expires);

  insert into public.custom_puzzle_secrets(puzzle_id,answer_word)
  values(new_id,answer);

  return jsonb_build_object(
    'puzzleCode',code,
    'mode',clean_mode,
    'wordLength',clean_length,
    'attemptLimit',attempts,
    'createdAt',clock_timestamp(),
    'expiresAt',expires
  );
end;
$$;

create or replace function public.get_custom_puzzle_state(p_puzzle_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  code text := upper(btrim(coalesce(p_puzzle_code,'')));
  p public.custom_puzzles%rowtype;
  play public.custom_puzzle_plays%rowtype;
  guesses jsonb;
  creator jsonb;
  answer text;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  if code !~ '^[A-Z2-9]{7}$' then raise exception 'Geçersiz özel bulmaca kodu'; end if;

  select * into p from public.custom_puzzles where puzzle_code=code;
  if not found or not p.enabled then raise exception 'Özel bulmaca bulunamadı'; end if;

  select * into play
  from public.custom_puzzle_plays
  where puzzle_id=p.id and player_id=uid;

  if not found then
    if p.expires_at<=clock_timestamp() then raise exception 'Bu özel bulmacanın süresi dolmuş'; end if;
    insert into public.custom_puzzle_plays(puzzle_id,player_id)
    values(p.id,uid)
    returning * into play;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',g.id,
    'guessNo',g.guess_no,
    'guessWord',g.guess_word,
    'feedback',g.feedback,
    'solved',g.solved,
    'createdAt',g.created_at
  ) order by g.guess_no),'[]'::jsonb)
  into guesses
  from public.custom_puzzle_guesses g
  where g.play_id=play.id;

  select jsonb_build_object('nickname',pr.nickname,'playerCode',pr.player_code)
  into creator
  from public.profiles pr
  where pr.id=p.creator_id;

  if play.status='ended' then
    select s.answer_word into answer
    from public.custom_puzzle_secrets s
    where s.puzzle_id=p.id;
  end if;

  return jsonb_build_object(
    'puzzleCode',p.puzzle_code,
    'mode',p.mode,
    'wordLength',p.word_length,
    'attemptLimit',p.attempt_limit,
    'status',play.status,
    'attemptsUsed',play.attempts_used,
    'won',play.won,
    'hintUsed',play.hint_used,
    'startedAt',play.started_at,
    'endedAt',play.ended_at,
    'createdAt',p.created_at,
    'expiresAt',p.expires_at,
    'createdByMe',p.creator_id=uid,
    'creator',creator,
    'answerWord',answer,
    'guesses',guesses,
    'serverNow',clock_timestamp()
  );
end;
$$;

create or replace function public.submit_custom_puzzle_guess(p_puzzle_code text,p_guess text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  code text := upper(btrim(coalesce(p_puzzle_code,'')));
  guess text := upper(btrim(coalesce(p_guess,'')));
  p public.custom_puzzles%rowtype;
  play public.custom_puzzle_plays%rowtype;
  secret text;
  fb jsonb;
  public_fb jsonb;
  next_attempt integer;
  solved boolean;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;

  select * into p from public.custom_puzzles where puzzle_code=code and enabled for update;
  if not found then raise exception 'Özel bulmaca bulunamadı'; end if;

  select * into play
  from public.custom_puzzle_plays
  where puzzle_id=p.id and player_id=uid
  for update;

  if not found then
    perform public.get_custom_puzzle_state(code);
    select * into play
    from public.custom_puzzle_plays
    where puzzle_id=p.id and player_id=uid
    for update;
  end if;

  if play.status='ended' then return public.get_custom_puzzle_state(code); end if;
  if p.expires_at<=clock_timestamp() then raise exception 'Bu özel bulmacanın süresi dolmuş'; end if;

  if char_length(guess)<>p.word_length or guess !~ '^[A-ZÇĞİÖŞÜ]+$' then
    raise exception 'Tahmin seçilen harf sayısıyla uyumlu değil';
  end if;

  if not exists(
    select 1 from public.multiplayer_guess_words w
    where w.length=p.word_length and w.word=guess
  ) then
    raise exception 'Kelime tahmin sözlüğünde bulunmuyor';
  end if;

  select s.answer_word into secret
  from public.custom_puzzle_secrets s
  where s.puzzle_id=p.id;
  if secret is null then raise exception 'Gizli cevap bulunamadı'; end if;

  fb:=public.live_feedback(guess,secret);
  public_fb:=case when p.mode='kelimelik' then fb-'pattern' else fb end;
  next_attempt:=play.attempts_used+1;
  solved:=guess=secret;

  insert into public.custom_puzzle_guesses(play_id,guess_no,guess_word,feedback,solved)
  values(play.id,next_attempt,guess,public_fb,solved);

  update public.custom_puzzle_plays
  set attempts_used=next_attempt,
      won=solved,
      status=case when solved or next_attempt>=p.attempt_limit then 'ended' else 'active' end,
      ended_at=case when solved or next_attempt>=p.attempt_limit then clock_timestamp() else null end
  where id=play.id;

  return public.get_custom_puzzle_state(code);
end;
$$;


create or replace function public.use_custom_puzzle_hint(p_puzzle_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  code text := upper(btrim(coalesce(p_puzzle_code,'')));
  p public.custom_puzzles%rowtype;
  play public.custom_puzzle_plays%rowtype;
  secret text;
  hint text;
  best_green integer := 0;
  fb jsonb;
  public_fb jsonb;
  next_attempt integer;
  solved boolean;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;

  select * into p from public.custom_puzzles where puzzle_code=code and enabled for update;
  if not found then raise exception 'Özel bulmaca bulunamadı'; end if;
  if p.mode<>'kelimelik' then raise exception 'Klasik Modda ipucu kullanılmaz'; end if;

  select * into play
  from public.custom_puzzle_plays
  where puzzle_id=p.id and player_id=uid
  for update;
  if not found then raise exception 'Önce bulmacayı aç'; end if;
  if play.status='ended' then return public.get_custom_puzzle_state(code); end if;
  if play.hint_used then raise exception 'Bu bulmacada ipucunu zaten kullandın'; end if;
  if play.attempts_used<1 then raise exception 'İpucu için önce en az bir tahmin gönder'; end if;
  if play.attempts_used>=p.attempt_limit then return public.get_custom_puzzle_state(code); end if;

  select s.answer_word into secret from public.custom_puzzle_secrets s where s.puzzle_id=p.id;
  if secret is null then raise exception 'Gizli cevap bulunamadı'; end if;

  select coalesce(max((g.feedback->>'green')::integer),0)
  into best_green
  from public.custom_puzzle_guesses g
  where g.play_id=play.id;

  -- Önce mevcut sayaçların tamamıyla tutarlı olası cevapları kullan.
  select aw.word into hint
  from public.multiplayer_answer_words aw
  where aw.answer_version='A1'
    and aw.length=p.word_length
    and aw.enabled
    and not exists(select 1 from public.custom_puzzle_guesses pg where pg.play_id=play.id and pg.guess_word=aw.word)
    and (public.live_feedback(aw.word,secret)->>'green')::integer>=best_green
    and not exists(
      select 1
      from public.custom_puzzle_guesses g
      where g.play_id=play.id
        and (
          (public.live_feedback(g.guess_word,aw.word)->>'green')::integer<>(g.feedback->>'green')::integer
          or (public.live_feedback(g.guess_word,aw.word)->>'yellow')::integer<>(g.feedback->>'yellow')::integer
          or (public.live_feedback(g.guess_word,aw.word)->>'red')::integer<>(g.feedback->>'red')::integer
        )
    )
  order by
    (aw.word=secret) asc,
    (
      (public.live_feedback(aw.word,secret)->>'green')::integer*4
      +(public.live_feedback(aw.word,secret)->>'yellow')::integer*2
      +random()
    ) desc
  limit 1;

  -- Çok dar/alışılmadık cevapta fallback yine yeşil sayısını geriye götürmez.
  if hint is null then
    select w.word into hint
    from public.multiplayer_guess_words w
    where w.length=p.word_length
      and not exists(select 1 from public.custom_puzzle_guesses pg where pg.play_id=play.id and pg.guess_word=w.word)
      and (public.live_feedback(w.word,secret)->>'green')::integer>=best_green
    order by
      (w.word=secret) asc,
      (
        (public.live_feedback(w.word,secret)->>'green')::integer*4
        +(public.live_feedback(w.word,secret)->>'yellow')::integer*2
        +random()
      ) desc
    limit 1;
  end if;

  if hint is null then hint:=secret; end if;

  fb:=public.live_feedback(hint,secret);
  public_fb:=fb-'pattern';
  next_attempt:=play.attempts_used+1;
  solved:=hint=secret;

  insert into public.custom_puzzle_guesses(play_id,guess_no,guess_word,feedback,solved)
  values(play.id,next_attempt,hint,public_fb,solved);

  update public.custom_puzzle_plays
  set attempts_used=next_attempt,
      hint_used=true,
      won=solved,
      status=case when solved or next_attempt>=p.attempt_limit then 'ended' else 'active' end,
      ended_at=case when solved or next_attempt>=p.attempt_limit then clock_timestamp() else null end
  where id=play.id;

  return public.get_custom_puzzle_state(code);
end;
$$;

-- İkili geçmiş ayrı bir yazılabilir sayaç yerine tamamlanmış insan maçlarından türetilir.
create or replace function public.get_head_to_head(p_player_code text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  target public.profiles%rowtype;
  total integer := 0;
  my_wins integer := 0;
  their_wins integer := 0;
  draws integer := 0;
  last_five jsonb := '[]'::jsonb;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;

  select * into target
  from public.profiles
  where player_code=upper(replace(btrim(coalesce(p_player_code,'')),'#',''));
  if not found then raise exception 'Oyuncu bulunamadı'; end if;

  if target.id=uid then
    return jsonb_build_object(
      'opponentNickname',target.nickname,
      'opponentPlayerCode',target.player_code,
      'totalMatches',0,'myWins',0,'opponentWins',0,'draws',0,'lastFive','[]'::jsonb
    );
  end if;

  select
    count(*)::integer,
    count(*) filter(where m.winner_id=uid)::integer,
    count(*) filter(where m.winner_id=target.id)::integer,
    count(*) filter(where m.winner_id is null)::integer
  into total,my_wins,their_wins,draws
  from public.live_matches m
  where m.status='ended'
    and ((m.host_id=uid and m.guest_id=target.id) or (m.host_id=target.id and m.guest_id=uid));

  select coalesce(jsonb_agg(x.item order by x.ended_at desc),'[]'::jsonb)
  into last_five
  from (
    select
      m.ended_at,
      jsonb_build_object(
        'matchId',m.id,
        'mode',m.mode,
        'wordLength',m.word_length,
        'endedAt',m.ended_at,
        'result',case
          when m.winner_id is null then 'draw'
          when m.winner_id=uid then 'win'
          else 'loss'
        end,
        'myAttempts',me.attempts_used,
        'opponentAttempts',opp.attempts_used
      ) as item
    from public.live_matches m
    join public.live_match_players me on me.match_id=m.id and me.player_id=uid
    join public.live_match_players opp on opp.match_id=m.id and opp.player_id=target.id
    where m.status='ended'
      and ((m.host_id=uid and m.guest_id=target.id) or (m.host_id=target.id and m.guest_id=uid))
    order by m.ended_at desc
    limit 5
  ) x;

  return jsonb_build_object(
    'opponentNickname',target.nickname,
    'opponentPlayerCode',target.player_code,
    'totalMatches',total,
    'myWins',my_wins,
    'opponentWins',their_wins,
    'draws',draws,
    'lastFive',last_five
  );
end;
$$;

revoke all on function public.make_custom_puzzle_code() from public, anon, authenticated;
revoke all on function public.create_custom_puzzle(text,integer,text) from public, anon;
revoke all on function public.get_custom_puzzle_state(text) from public, anon;
revoke all on function public.submit_custom_puzzle_guess(text,text) from public, anon;
revoke all on function public.use_custom_puzzle_hint(text) from public, anon;
revoke all on function public.get_head_to_head(text) from public, anon;

grant execute on function public.create_custom_puzzle(text,integer,text) to authenticated;
grant execute on function public.get_custom_puzzle_state(text) to authenticated;
grant execute on function public.submit_custom_puzzle_guess(text,text) to authenticated;
grant execute on function public.use_custom_puzzle_hint(text) to authenticated;
grant execute on function public.get_head_to_head(text) to authenticated;
