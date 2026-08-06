-- ═══════════════════════════════════════════════════════════════
--  FAB Operations Hub — Supabase schema
--  ย้ายจาก Google Sheets (Apps Script) มาเก็บที่นี่
--  วิธีใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run
--  รันซ้ำได้ ไม่ลบข้อมูลเดิม (ใช้ if not exists ทั้งหมด)
-- ═══════════════════════════════════════════════════════════════

-- ───────────── คำขออบรม ─────────────
-- ตรงกับ REQ_HEADERS ใน apps-script/Code.gs
create table if not exists public.fh_requests (
  id          bigserial primary key,
  ts          timestamptz not null default now(),   -- = timestamp (วันที่ส่ง)
  name        text not null,
  emp_id      text,
  id_card     text,
  branch      text,
  position    text,
  course      text,
  train_date  text,          -- เก็บเป็นข้อความไทยเหมือนเดิม กันฟอร์แมตเพี้ยนตอนย้าย
  time_slot   text,
  note        text,
  round       text,          -- รุ่นที่ (snapshot ตอนส่ง)
  brand       text,
  created_at  timestamptz not null default now()
);

-- ตัวกรองที่หน้าแอดมินใช้บ่อยสุด — มี index แล้ว query ไม่ต้องสแกนทั้งตาราง
create index if not exists fh_requests_branch_idx     on public.fh_requests (branch);
create index if not exists fh_requests_course_idx     on public.fh_requests (course);
create index if not exists fh_requests_ts_idx         on public.fh_requests (ts desc);
-- 1 "รุ่น" = หลักสูตร + วันอบรม + รอบเวลา
create index if not exists fh_requests_session_idx    on public.fh_requests (course, train_date, time_slot);
-- กันส่งซ้ำ: คนเดิม หลักสูตรเดิม รอบเดิม
create unique index if not exists fh_requests_dup_idx
  on public.fh_requests (id_card, course, train_date, time_slot)
  where id_card is not null and id_card <> '';

-- ───────────── ใบรับรอง ─────────────
create table if not exists public.fh_certificates (
  id           bigserial primary key,
  cert_name    text,          -- ชื่อในใบรับรอง
  course       text,          -- หลักสูตร
  train_date   text,          -- วันอบรม
  expire_date  text,          -- วันหมดอายุ
  exp_status   text,          -- สถานะใบรับรอง
  emp_name     text,          -- ชื่อในระบบ
  branch       text,          -- สาขา
  position     text,          -- ตำแหน่ง
  sheet        text,          -- Sheet
  match_type   text,          -- สถานะจับคู่
  created_at   timestamptz not null default now()
);
create index if not exists fh_certificates_name_idx   on public.fh_certificates (cert_name);
create index if not exists fh_certificates_emp_idx    on public.fh_certificates (emp_name);
create index if not exists fh_certificates_branch_idx on public.fh_certificates (branch);
create index if not exists fh_certificates_exp_idx    on public.fh_certificates (expire_date);

-- ───────────── ทะเบียนพนักงาน ─────────────
create table if not exists public.fh_employees (
  id         bigserial primary key,
  name       text not null,
  emp_id     text,
  id_card    text,
  branch     text,
  position   text,
  sheet      text,
  created_at timestamptz not null default now()
);
create index if not exists fh_employees_name_idx   on public.fh_employees (name);
create index if not exists fh_employees_branch_idx on public.fh_employees (branch);
create unique index if not exists fh_employees_empid_idx
  on public.fh_employees (emp_id) where emp_id is not null and emp_id <> '';

-- ═══════════════════════════════════════════════════════════════
--  RLS
--  หมายเหตุความปลอดภัย: หน้าเว็บเรียกด้วย anon key จากเบราว์เซอร์ตรง ๆ
--  จึงต้องเปิดให้ anon อ่าน/เขียนได้ = ระดับเดียวกับ Apps Script web app
--  ที่ตั้ง "Anyone" อยู่ตอนนี้ ไม่ได้แย่ลง แต่ก็ไม่ได้ปลอดภัยขึ้น
--  ถ้าจะรัดกุมกว่านี้ต้องมี auth จริง (Supabase Auth) แล้วค่อยล็อก policy ตาม role
-- ═══════════════════════════════════════════════════════════════
alter table public.fh_requests     enable row level security;
alter table public.fh_certificates enable row level security;
alter table public.fh_employees    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['fh_requests','fh_certificates','fh_employees'] loop
    execute format('drop policy if exists %I on public.%I', t || '_anon_all', t);
    execute format(
      'create policy %I on public.%I for all to anon using (true) with check (true)',
      t || '_anon_all', t);
  end loop;
end $$;

-- ───────────── ตรวจผลหลังรัน ─────────────
select 'fh_requests'     as table_name, count(*) as rows from public.fh_requests
union all
select 'fh_certificates', count(*) from public.fh_certificates
union all
select 'fh_employees',    count(*) from public.fh_employees;
