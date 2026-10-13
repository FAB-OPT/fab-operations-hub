-- ════════════════════════════════════════════════════════════════════
-- Customer Feedback Collection — ที่เก็บกลาง (ช่องทาง VOC · Facebook)
--
-- โปรเจกต์: FAB HUB (pzspcjqlxoqnbtvlfjsy)
-- วิธีใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้ ไม่พัง)
--
-- ลำดับงาน:  นำเข้าไฟล์ดิบ → ชุดตรวจสอบ (staging) → แอดมินกรอง/แก้ไข → แอดมินอนุมัติ → ข้อมูลลงระบบ (live)
--
--   fb_batches  1 แถว = 1 ไฟล์ที่นำเข้า (status: staging รอตรวจสอบ · approved อนุมัติแล้ว)
--   fb_rows     คอมเมนต์ทีละแถว   state: staging (จะลงระบบเมื่ออนุมัติ) · drop (ข้าม) · live (อยู่ในระบบแล้ว)
--   fb_csat     CSAT/NPS รายเดือนต่อ BZM (KT/JD) หรือ Owner (FS) — คำนวณจากแบบสำรวจทุกใบในไฟล์
--
-- กติกา
--   · นำเข้าไฟล์เดิมซ้ำ = ข้ามแถวที่เคยนำเข้าแล้ว (ใช้ RD ID จากไฟล์ดิบเป็นกุญแจ)
--   · อนุมัติชุดใหม่ที่ทับเดือน/BZM เดิม = CSAT/NPS ของเดือนนั้นถูกแทนที่ด้วยชุดใหม่
--     (ถอนการอนุมัติไม่ได้คืนค่าที่ถูกแทนที่ — ให้นำเข้าไฟล์เดิมใหม่)
--   · สิทธิ์ผู้ใช้ (admin / bzm / สาขา) กรองฝั่งหน้าจอ เหมือนส่วนอื่นของฮับ — ตารางตั้งไว้ให้ผู้ที่ล็อกอิน (authenticated) เท่านั้น
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.fb_batches (
  id          uuid primary key default gen_random_uuid(),
  channel     text not null default 'voc',
  file_name   text not null default '',
  d_from      date,
  d_to        date,
  n_rows      int  not null default 0,
  n_csat      int  not null default 0,
  note        text not null default '',
  status      text not null default 'staging' check (status in ('staging', 'approved')),
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  approved_by text not null default '',
  approved_at timestamptz
);

create table if not exists public.fb_rows (
  id          bigint generated always as identity primary key,
  batch_id    uuid not null references public.fb_batches(id) on delete cascade,
  channel     text not null default 'voc',
  src_id      text not null,                       -- RD ID จากไฟล์ดิบ + ชนิด (p/n/s) กันนำเข้าซ้ำ
  state       text not null default 'staging' check (state in ('staging', 'drop', 'live')),
  b           text not null default '',            -- KT | FS | JD
  d           date,
  t           text not null default '',
  ty          text not null default '',            -- พอใจ | ไม่พอใจ | ข้อเสนอแนะ
  br          text not null default '',            -- "5042 ฟิวเจอร์พาร์ค รังสิต"
  z           text not null default '',            -- BZM
  o           text not null default '',            -- Owner (FS)
  s           numeric,                             -- คะแนน CSAT ของใบนั้น
  c           text not null default '',            -- ข้อความ (ปิดบังเบอร์/อีเมลแล้ว)
  sub         text not null default '',            -- หัวข้อย่อย
  main        text not null default '',            -- หัวข้อหลัก
  extra       jsonb not null default '{}'::jsonb,  -- หัวข้ออื่นในใบเดียวกัน · ธงที่ระบบใส่ให้
  edited      boolean not null default false,
  updated_at  timestamptz not null default now()
);
create unique index if not exists fb_rows_src on public.fb_rows (channel, src_id);
create index if not exists fb_rows_batch on public.fb_rows (batch_id, state);
create index if not exists fb_rows_live  on public.fb_rows (state, d);

create table if not exists public.fb_csat (
  id          bigint generated always as identity primary key,
  batch_id    uuid not null references public.fb_batches(id) on delete cascade,
  channel     text not null default 'voc',
  state       text not null default 'staging' check (state in ('staging', 'drop', 'live')),
  b           text not null default '',
  k           text not null default '',            -- ชื่อ BZM (KT/JD) หรือ Owner (FS)
  d_from      date not null,
  d_to        date not null,
  n           int  not null default 0,             -- จำนวนใบสำรวจที่ใช้คำนวณ
  cs          numeric not null,                    -- CSAT (คะแนนเฉลี่ย x10 → 0-100)
  np          numeric not null,                    -- NPS (% ผู้แนะนำ - % ผู้ไม่แนะนำ → -100..100)
  edited      boolean not null default false,
  updated_at  timestamptz not null default now()
);
create index if not exists fb_csat_batch on public.fb_csat (batch_id, state);
create index if not exists fb_csat_live  on public.fb_csat (state, d_from);

-- ── สิทธิ์: ต้องล็อกอิน (แบบไม่ระบุตัวตนก็นับ) — แนวเดียวกับ hub_docs ──
alter table public.fb_batches enable row level security;
alter table public.fb_rows    enable row level security;
alter table public.fb_csat    enable row level security;
drop policy if exists fb_batches_all_auth on public.fb_batches;
drop policy if exists fb_rows_all_auth    on public.fb_rows;
drop policy if exists fb_csat_all_auth    on public.fb_csat;
create policy fb_batches_all_auth on public.fb_batches for all to authenticated using (true) with check (true);
create policy fb_rows_all_auth    on public.fb_rows    for all to authenticated using (true) with check (true);
create policy fb_csat_all_auth    on public.fb_csat    for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.fb_batches, public.fb_rows, public.fb_csat to authenticated;
revoke all on public.fb_batches, public.fb_rows, public.fb_csat from anon;
grant usage, select on all sequences in schema public to authenticated;

-- ── แก้หลายแถวพร้อมกัน (แก้ได้เฉพาะชุดที่ยังรอตรวจสอบ) ──
-- p_patch ใช้ได้: state ty sub main z o br c  (ฟิลด์ที่ไม่ส่ง = ไม่แตะ)
create or replace function public.fb_rows_set(p_batch uuid, p_ids bigint[], p_patch jsonb)
returns jsonb language plpgsql as $$
declare
  v_n int;
begin
  if not exists (select 1 from public.fb_batches where id = p_batch and status = 'staging') then
    return jsonb_build_object('ok', false, 'error', 'ชุดนี้อนุมัติแล้วหรือไม่พบ');
  end if;
  if p_patch ? 'state' and (p_patch ->> 'state') not in ('staging', 'drop') then
    return jsonb_build_object('ok', false, 'error', 'state ไม่ถูกต้อง');
  end if;
  update public.fb_rows r set
    state  = coalesce(p_patch ->> 'state', r.state),
    ty     = case when p_patch ? 'ty'   then left(p_patch ->> 'ty', 20)    else r.ty   end,
    sub    = case when p_patch ? 'sub'  then left(p_patch ->> 'sub', 120)  else r.sub  end,
    main   = case when p_patch ? 'main' then left(p_patch ->> 'main', 80)  else r.main end,
    z      = case when p_patch ? 'z'    then left(p_patch ->> 'z', 80)     else r.z    end,
    o      = case when p_patch ? 'o'    then left(p_patch ->> 'o', 80)     else r.o    end,
    br     = case when p_patch ? 'br'   then left(p_patch ->> 'br', 120)   else r.br   end,
    c      = case when p_patch ? 'c'    then left(p_patch ->> 'c', 4000)   else r.c    end,
    edited = true, updated_at = now()
  where r.batch_id = p_batch and r.id = any(p_ids) and r.state in ('staging', 'drop');
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'n', v_n);
end $$;

-- ── แก้/ข้าม CSAT-NPS ──
create or replace function public.fb_csat_set(p_batch uuid, p_ids bigint[], p_patch jsonb)
returns jsonb language plpgsql as $$
declare
  v_n int;
begin
  if not exists (select 1 from public.fb_batches where id = p_batch and status = 'staging') then
    return jsonb_build_object('ok', false, 'error', 'ชุดนี้อนุมัติแล้วหรือไม่พบ');
  end if;
  if p_patch ? 'state' and (p_patch ->> 'state') not in ('staging', 'drop') then
    return jsonb_build_object('ok', false, 'error', 'state ไม่ถูกต้อง');
  end if;
  update public.fb_csat r set
    state  = coalesce(p_patch ->> 'state', r.state),
    k      = case when p_patch ? 'k'  then left(p_patch ->> 'k', 80) else r.k end,
    cs     = case when p_patch ? 'cs' then (p_patch ->> 'cs')::numeric else r.cs end,
    np     = case when p_patch ? 'np' then (p_patch ->> 'np')::numeric else r.np end,
    edited = true, updated_at = now()
  where r.batch_id = p_batch and r.id = any(p_ids) and r.state in ('staging', 'drop');
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'n', v_n);
end $$;

-- ── อนุมัติ: ข้อมูลลงระบบ ──
-- เข้าระบบเฉพาะแถวที่ state = staging, ประเภท พอใจ/ไม่พอใจ และมีข้อความ
create or replace function public.fb_approve(p_batch uuid, p_by text default '')
returns jsonb language plpgsql as $$
declare
  v_rows int; v_csat int; v_replaced int := 0;
begin
  if not exists (select 1 from public.fb_batches where id = p_batch and status = 'staging' for update) then
    return jsonb_build_object('ok', false, 'error', 'ชุดนี้อนุมัติแล้วหรือไม่พบ');
  end if;

  -- CSAT/NPS เดือนเดียวกัน + BZM/Owner เดียวกัน ที่เคยอนุมัติไว้ → แทนที่ด้วยของชุดนี้
  delete from public.fb_csat o
   where o.state = 'live' and o.channel = 'voc'
     and exists (select 1 from public.fb_csat n
                  where n.batch_id = p_batch and n.state = 'staging'
                    and n.b = o.b and n.k = o.k and date_trunc('month', n.d_from) = date_trunc('month', o.d_from));
  get diagnostics v_replaced = row_count;

  update public.fb_csat set state = 'live', updated_at = now() where batch_id = p_batch and state = 'staging';
  get diagnostics v_csat = row_count;

  update public.fb_rows set state = 'live', updated_at = now()
   where batch_id = p_batch and state = 'staging'
     and ty in ('พอใจ', 'ไม่พอใจ') and btrim(c) <> '';
  get diagnostics v_rows = row_count;

  update public.fb_batches set status = 'approved', approved_by = left(coalesce(p_by, ''), 80), approved_at = now()
   where id = p_batch;
  return jsonb_build_object('ok', true, 'rows', v_rows, 'csat', v_csat, 'csatReplaced', v_replaced);
end $$;

-- ── ถอนการอนุมัติ: ข้อมูลของชุดนี้ออกจากระบบ กลับไปรอตรวจสอบ ──
create or replace function public.fb_revoke(p_batch uuid)
returns jsonb language plpgsql as $$
begin
  if not exists (select 1 from public.fb_batches where id = p_batch and status = 'approved' for update) then
    return jsonb_build_object('ok', false, 'error', 'ชุดนี้ยังไม่ได้อนุมัติหรือไม่พบ');
  end if;
  update public.fb_rows set state = 'staging', updated_at = now() where batch_id = p_batch and state = 'live';
  update public.fb_csat set state = 'staging', updated_at = now() where batch_id = p_batch and state = 'live';
  update public.fb_batches set status = 'staging', approved_by = '', approved_at = null where id = p_batch;
  return jsonb_build_object('ok', true);
end $$;


-- ── ติดตามเคส Facebook ที่ลงระบบแล้ว: อัปเดตสถานะ/ผู้รับผิดชอบ/หมายเหตุ/ลิงก์/วันที่ปิดเคส ──
-- (เนื้อหาเคสแก้ไม่ได้ — แก้ได้เฉพาะช่องติดตาม · ใครมีสิทธิ์จัดการในฮับทำได้ ตรวจสิทธิ์ที่หน้าจอ)
create or replace function public.fb_row_extra(p_id bigint, p_extra jsonb, p_by text default '')
returns jsonb language plpgsql as $$
declare
  v_keep jsonb := '{}'::jsonb;
  k text;
begin
  if p_extra is null or jsonb_typeof(p_extra) <> 'object' then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  for k in select jsonb_object_keys(p_extra) loop
    if k in ('status', 'owner', 'note', 'link', 'closedAt') then
      v_keep := v_keep || jsonb_build_object(k, left(p_extra ->> k, 300));
    end if;
  end loop;
  if v_keep ? 'status' and (v_keep ->> 'status') not in ('new', 'doing', 'done') then
    return jsonb_build_object('ok', false, 'error', 'status ไม่ถูกต้อง');
  end if;
  v_keep := v_keep || jsonb_build_object('updatedBy', left(coalesce(p_by, ''), 80), 'updatedAt', now());
  update public.fb_rows set extra = extra || v_keep, updated_at = now()
   where id = p_id and state = 'live' and channel = 'facebook';
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบเคสที่ลงระบบแล้ว'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fb_rows_set(uuid, bigint[], jsonb) from public, anon;
revoke all on function public.fb_csat_set(uuid, bigint[], jsonb) from public, anon;
revoke all on function public.fb_approve(uuid, text)             from public, anon;
revoke all on function public.fb_revoke(uuid)                    from public, anon;
revoke all on function public.fb_row_extra(bigint, jsonb, text)  from public, anon;
grant execute on function public.fb_rows_set(uuid, bigint[], jsonb) to authenticated;
grant execute on function public.fb_csat_set(uuid, bigint[], jsonb) to authenticated;
grant execute on function public.fb_approve(uuid, text)             to authenticated;
grant execute on function public.fb_revoke(uuid)                    to authenticated;
grant execute on function public.fb_row_extra(bigint, jsonb, text)  to authenticated;

notify pgrst, 'reload schema';
