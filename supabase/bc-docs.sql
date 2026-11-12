-- ════════════════════════════════════════════════════════════════════
-- Booth & Catering Desk · ย้ายเข้าฐานข้อมูลของฮับ (โปรเจกต์ FAB HUB · pzspcjqlxoqnbtvlfjsy)
--
-- วิธีใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้ ไม่พัง · ไม่แตะตารางอื่นของฮับ)
--
-- สิ่งที่สร้าง
--   1) bc_docs        ตารางเก็บเอกสารของแอป (งาน · P&L รายวัน · ความคืบหน้า · สลิป · เมนู · ต้นทุนคงที่ · การแจ้งเตือน)
--                      แบบเดียวกับ planner_docs ของฮับ: สิทธิ์ authenticated (ฮับล็อกอินแบบ anonymous) · สิทธิ์ใช้งานคุมที่หน้าสิทธิ์ของฮับ
--   2) bc_set / bc_update / bc_delete   ฟังก์ชันเขียนเอกสาร (set = รวมฟิลด์ที่ส่งมากับของเดิม เหมือนเดิมของแอป)
--   3) bc_job_lock    ล็อกงานหลังวันจัดงานสุดท้าย 7 วัน (เวลาไทย) · เปิดแก้ไขได้ด้วย unlockUntil (แอดมินระบบกด "เปิดแก้ไข" ในแอป)
--   4) bc_import      ฟังก์ชันสำหรับหน้าย้ายข้อมูลเดิมเท่านั้น (ข้ามกฎล็อก เพื่อนำงานเก่าเข้า)
--   5) แจ้งเตือน Telegram เมื่อมีงานใหม่ / แก้ไข / ลบ (ต้องเก็บ bot token ใน Vault — ดูท้ายไฟล์ · ยังไม่เก็บ = ไม่ส่ง ไม่กระทบการบันทึก)
--   6) ที่เก็บไฟล์ bc-slips (สลิปชำระเงิน + เอกสารของงาน) เป็นแบบ private
-- ════════════════════════════════════════════════════════════════════

-- ───────── 1) ตารางเอกสาร ─────────
-- col = ที่อยู่ของกลุ่มเอกสาร เช่น  b/jaedang/events · b/jaedang/events/<รหัสงาน>/pl · b/jaedang/menus · b/jaedang/settings · b/jaedang/activity · reads · people
create table if not exists public.bc_docs (
  col         text not null,
  id          text not null,
  data        jsonb not null default '{}'::jsonb,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default '',
  primary key (col, id)
);

alter table public.bc_docs enable row level security;
drop policy if exists bc_docs_all_auth on public.bc_docs;
create policy bc_docs_all_auth on public.bc_docs for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.bc_docs to authenticated;
revoke all on public.bc_docs from anon;

-- ───────── 2) ฟังก์ชันเขียนเอกสาร ─────────
-- set: ถ้ามีอยู่แล้ว รวมฟิลด์ที่ส่งมาทับของเดิมเฉพาะฟิลด์นั้น (ฟิลด์ที่ไม่ได้ส่งคงเดิม) · ถ้าเคยถูกลบ เริ่มเป็นเอกสารใหม่
create or replace function public.bc_set(p_col text, p_id text, p_data jsonb, p_by text default '')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  insert into public.bc_docs (col, id, data, deleted, updated_at, updated_by)
  values (p_col, p_id, coalesce(p_data, '{}'::jsonb), false, now(), coalesce(p_by, ''))
  on conflict (col, id) do update
    set data = case when public.bc_docs.deleted then excluded.data else public.bc_docs.data || excluded.data end,
        deleted = false, updated_at = now(), updated_by = excluded.updated_by
  returning data into r;
  return r;
end $$;

-- update: ต้องมีเอกสารอยู่แล้ว ไม่งั้นแจ้ง error (เหมือนเดิมของแอป)
create or replace function public.bc_update(p_col text, p_id text, p_data jsonb, p_by text default '')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  update public.bc_docs
     set data = data || coalesce(p_data, '{}'::jsonb), updated_at = now(), updated_by = coalesce(p_by, '')
   where col = p_col and id = p_id and not deleted
  returning data into r;
  if r is null then raise exception 'bc_not_found' using errcode = 'P0002'; end if;
  return r;
end $$;

-- delete: ลบแบบเก็บไว้ (deleted = true) กู้คืนได้จากฐาน
create or replace function public.bc_delete(p_col text, p_id text, p_by text default '')
returns void language plpgsql as $$
begin
  update public.bc_docs set deleted = true, updated_at = now(), updated_by = coalesce(p_by, '')
   where col = p_col and id = p_id;
end $$;

grant execute on function public.bc_set(text, text, jsonb, text) to authenticated;
grant execute on function public.bc_update(text, text, jsonb, text) to authenticated;
grant execute on function public.bc_delete(text, text, text) to authenticated;

-- ───────── 3) ล็อกงาน 7 วันหลังวันจัดงานสุดท้าย ─────────
-- ใช้กับ: เอกสารงาน (b/<แบรนด์>/events) และลูกของงาน (pl · updates · payments)
-- เปิดแก้ไขชั่วคราว: ตั้ง unlockUntil (YYYY-MM-DD) ที่เอกสารงาน — การแก้เฉพาะ unlockUntil ผ่านได้เสมอ
create or replace function public.bc_job_lock() returns trigger
language plpgsql as $$
declare
  ev jsonb; lastd date; unl date;
  today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if coalesce(current_setting('bc.import', true), '') = 'on' then return new; end if;   -- หน้าย้ายข้อมูลเดิม

  if new.col ~ '^b/[^/]+/events/[^/]+/(pl|updates|payments)$' then
    select data into ev from public.bc_docs
     where col = 'b/' || split_part(new.col, '/', 2) || '/events' and id = split_part(new.col, '/', 4) and not deleted;
  elsif new.col ~ '^b/[^/]+/events$' then
    if tg_op = 'INSERT' then return new; end if;
    if (old.data->>'unlockUntil') is distinct from (new.data->>'unlockUntil') then return new; end if;   -- แอดมินเปิด/ปิดการล็อก
    ev := old.data;                                           -- ตัดสินจากงานที่บันทึกอยู่ก่อนแก้
  else
    return new;
  end if;

  if ev is null then return new; end if;
  if coalesce(ev->>'status', '') in ('cancelled', 'tbd') then return new; end if;
  begin
    select max(nullif(x.v, '')::date) into lastd from jsonb_array_elements_text(coalesce(ev->'dates', '[]'::jsonb)) as x(v);
  exception when others then
    return new;   -- วันที่ในงานอ่านไม่ได้ ไม่ล็อก (ดีกว่าบล็อกการบันทึก)
  end;
  if lastd is null or lastd + 7 >= today then return new; end if;
  begin unl := nullif(ev->>'unlockUntil', '')::date; exception when others then unl := null; end;
  if unl is not null and unl >= today then return new; end if;
  raise exception 'งานนี้ปิดแล้ว (เกิน 7 วันหลังวันจัดงาน) — แอดมินระบบต้องกด "เปิดแก้ไข" ก่อน' using errcode = 'P0001';
end $$;

drop trigger if exists bc_docs_job_lock on public.bc_docs;
create trigger bc_docs_job_lock before insert or update on public.bc_docs
  for each row execute function public.bc_job_lock();

-- ───────── 4) นำเข้าข้อมูลเดิม (ใช้กับหน้า modules/New/migrate.html เท่านั้น) ─────────
-- รับ [{col,id,data,updated_at?}] เขียนทับเอกสารที่ id ตรงกัน · ข้ามกฎล็อก
create or replace function public.bc_import(p_rows jsonb)
returns integer language plpgsql as $$
declare n integer := 0; x jsonb;
begin
  perform set_config('bc.import', 'on', true);
  for x in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    insert into public.bc_docs (col, id, data, deleted, updated_at, updated_by)
    values (x->>'col', x->>'id', coalesce(x->'data', '{}'::jsonb), false,
            coalesce(nullif(x->>'updated_at', '')::timestamptz, now()), 'import')
    on conflict (col, id) do update
      set data = excluded.data, deleted = false, updated_at = excluded.updated_at, updated_by = 'import';
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.bc_import(jsonb) to authenticated;

-- ───────── 5) ที่เก็บไฟล์ (สลิป + เอกสารของงาน) ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bc-slips', 'bc-slips', false, 52428800, array['image/png','image/jpeg','image/webp','application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do nothing;

drop policy if exists bc_slips_all_auth on storage.objects;
create policy bc_slips_all_auth on storage.objects for all to authenticated
  using (bucket_id = 'bc-slips') with check (bucket_id = 'bc-slips');

-- ───────── 6) แจ้งเตือน Telegram (งานใหม่ / แก้ไข / ลบ) ─────────
create extension if not exists pg_net with schema extensions;

create or replace function public.bc_notify_telegram() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  brand text; tok text; chat text; who text; bname text; head text; msg text;
  esc_title text; esc_detail text; d jsonb := new.data;
begin
  if new.col !~ '^b/[^/]+/activity$' then return new; end if;
  if coalesce(d->>'type', '') not in ('new', 'edit', 'del') then return new; end if;
  brand := split_part(new.col, '/', 2);
  select decrypted_secret into tok  from vault.decrypted_secrets where name = 'telegram_bot_token_' || brand limit 1;
  select decrypted_secret into chat from vault.decrypted_secrets where name = 'telegram_chat_' || brand limit 1;
  if chat is null then select decrypted_secret into chat from vault.decrypted_secrets where name = 'telegram_chat_id' limit 1; end if;
  if tok is null or chat is null then return new; end if;
  select coalesce(nullif(p.data->>'name', ''), d->>'by') into who from public.bc_docs p where p.col = 'people' and p.id = d->>'by';
  bname := case brand when 'jaedang' then 'เจ๊แดง' when 'tsc' then 'Top Secret Café' else brand end;
  head := case d->>'type' when 'new' then '🆕 งานใหม่' when 'edit' then '✏️ แก้ไขงาน' else '🗑️ ลบงาน' end;
  esc_title  := replace(replace(replace(coalesce(d->>'title', ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  esc_detail := replace(replace(replace(coalesce(d->>'detail', d->>'text', ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  msg := head || ' · ' || bname || E'\n<b>' || esc_title || '</b>'
      || case when esc_detail <> '' then E'\n' || esc_detail else '' end
      || case when who is not null and who <> '' then E'\nโดย ' || replace(replace(who, '<', '&lt;'), '>', '&gt;') else '' end
      || E'\nเปิดระบบ Booth &amp; Catering Desk ได้จากหน้าฮับ';
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || tok || '/sendMessage',
    body := jsonb_build_object('chat_id', chat, 'text', msg, 'parse_mode', 'HTML', 'disable_web_page_preview', true),
    headers := '{"Content-Type":"application/json"}'::jsonb);
  return new;
exception when others then
  return new;   -- ห้ามให้ Telegram ขัดการบันทึก
end $$;

revoke all on function public.bc_notify_telegram() from public, anon, authenticated;

drop trigger if exists bc_docs_telegram on public.bc_docs;
create trigger bc_docs_telegram after insert on public.bc_docs
  for each row execute function public.bc_notify_telegram();

-- ════════ ขั้นตอนเสริม: เปิดแจ้งเตือน Telegram (รันแยก · แทนค่าจริง · ห้ามส่งโทเคนในแชต) ════════
-- select vault.create_secret('BOT TOKEN ของเจ๊แดง', 'telegram_bot_token_jaedang');
-- select vault.create_secret('CHAT ID กลุ่มเจ๊แดง', 'telegram_chat_jaedang');
-- select vault.create_secret('BOT TOKEN ของ TSC', 'telegram_bot_token_tsc');
-- select vault.create_secret('CHAT ID กลุ่ม TSC', 'telegram_chat_tsc');
