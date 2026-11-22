-- HilinGo access codes. Run once in the Supabase SQL editor.
-- The browser only ever uses the anon key. Do not put the service_role key in the app.

create table if not exists public.access_codes (
  code text primary key,
  label text,
  device_id text,
  activated_at timestamptz,
  last_seen timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.admins (
  email text primary key
);

create table if not exists public.code_guesses (
  id bigint generated always as identity primary key,
  device_id text,
  tried_at timestamptz not null default now()
);

alter table public.access_codes enable row level security;
alter table public.admins enable row level security;
alter table public.code_guesses enable row level security;

-- No policies: the anon key cannot read or write these tables directly.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.norm_code(p_code text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function public.claim_code(p_code text, p_device text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  row public.access_codes%rowtype;
  want text;
begin
  if p_device is null or length(p_device) < 8 then
    return jsonb_build_object('status', 'invalid');
  end if;
  select count(*) into n from public.code_guesses
    where device_id = p_device and tried_at > now() - interval '60 seconds';
  if n >= 8 then
    return jsonb_build_object('status', 'slow');
  end if;
  insert into public.code_guesses(device_id) values (p_device);

  want := public.norm_code(p_code);
  if length(want) < 4 then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into row from public.access_codes
    where public.norm_code(code) = want
    limit 1;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  if row.revoked then
    return jsonb_build_object('status', 'revoked');
  end if;
  if row.device_id is null then
    update public.access_codes
      set device_id = p_device, activated_at = now(), last_seen = now()
      where code = row.code and device_id is null;
    return jsonb_build_object('status', 'ok');
  end if;
  if row.device_id = p_device then
    update public.access_codes set last_seen = now() where code = row.code;
    return jsonb_build_object('status', 'ok');
  end if;
  return jsonb_build_object('status', 'used_on_other_device');
end;
$$;

create or replace function public.check_access(p_code text, p_device text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.access_codes%rowtype;
  want text;
begin
  want := public.norm_code(p_code);
  select * into row from public.access_codes
    where public.norm_code(code) = want
    limit 1;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  if row.revoked then
    return jsonb_build_object('status', 'revoked');
  end if;
  if row.device_id is null or row.device_id <> p_device then
    return jsonb_build_object('status', 'used_on_other_device');
  end if;
  update public.access_codes set last_seen = now() where code = row.code;
  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.admin_create_code(p_label text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  raw text;
  made text;
  i int;
  guard int := 0;
begin
  if not public.is_admin() then
    raise exception 'not admin';
  end if;
  loop
    raw := '';
    for i in 1..6 loop
      raw := raw || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    made := substr(raw, 1, 3) || '-' || substr(raw, 4, 3);
    exit when not exists (select 1 from public.access_codes where code = made);
    guard := guard + 1;
    exit when guard > 20;
  end loop;
  insert into public.access_codes(code, label) values (made, nullif(trim(coalesce(p_label, '')), ''));
  return jsonb_build_object('status', 'ok', 'code', made, 'label', nullif(trim(coalesce(p_label, '')), ''));
end;
$$;

create or replace function public.admin_list_codes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not admin';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', code,
      'label', label,
      'device_id', device_id,
      'activated_at', activated_at,
      'last_seen', last_seen,
      'revoked', revoked,
      'created_at', created_at
    ) order by created_at desc)
    from public.access_codes
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_revoke_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  update public.access_codes set revoked = true where public.norm_code(code) = public.norm_code(p_code);
  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.admin_release_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  update public.access_codes
    set device_id = null, activated_at = null, revoked = false
    where public.norm_code(code) = public.norm_code(p_code);
  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.admin_delete_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  delete from public.access_codes where public.norm_code(code) = public.norm_code(p_code);
  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on public.access_codes from public, anon, authenticated;
revoke all on public.admins from public, anon, authenticated;
revoke all on public.code_guesses from public, anon, authenticated;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.claim_code(text, text) from public;
revoke all on function public.check_access(text, text) from public;
revoke all on function public.admin_create_code(text) from public, anon;
revoke all on function public.admin_list_codes() from public, anon;
revoke all on function public.admin_revoke_code(text) from public, anon;
revoke all on function public.admin_release_code(text) from public, anon;
revoke all on function public.admin_delete_code(text) from public, anon;

grant execute on function public.claim_code(text, text) to anon, authenticated;
grant execute on function public.check_access(text, text) to anon, authenticated;
grant execute on function public.admin_create_code(text) to authenticated;
grant execute on function public.admin_list_codes() to authenticated;
grant execute on function public.admin_revoke_code(text) to authenticated;
grant execute on function public.admin_release_code(text) to authenticated;
grant execute on function public.admin_delete_code(text) to authenticated;

-- After creating your login in Authentication → Users, add that email:
-- insert into public.admins(email) values ('you@example.com');
