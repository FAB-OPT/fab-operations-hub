-- ════════════════════════════════════════════════════════════════════
-- ระบบผู้สัมผัสอาหาร: คำขออบรม + ใบรับรอง  —  modules/food-handler.html (fh-supabase.js)
--
-- โปรเจกต์: FAB HUB (pzspcjqlxoqnbtvlfjsy)
-- วิธีใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้ ไม่พัง)
--
-- ย้ายมาจากโปรเจกต์ Training Record (cyjfgperenakjeazsfgf) — 22 ก.ย. 2569
--   · ทะเบียนพนักงาน (fh_employees) อยู่ที่ Training Record เหมือนเดิม ใช้ร่วมกับระบบ Training Record
--   · ใบรับรองมีคอลัมน์ตัวชี้ไปหาคนตั้งแต่แรก (emp_id · id_card · branch_at_train · match_by)
--     ที่โปรเจกต์เดิมเพิ่มไม่ได้ (supabase/fh-cert-link.sql รันไม่ได้) การจับคู่จึงไม่ถูกจำ
--   · ช่วงเปลี่ยนผ่านยังเขียนสำเนาลง Google Sheets เหมือนเดิม
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.fh_requests (
  id          bigserial primary key,
  ts          timestamptz not null default now(),   -- วันที่ส่ง
  name        text not null,
  emp_id      text,
  id_card     text,
  branch      text,
  position    text,
  course      text,
  train_date  text,
  time_slot   text,
  note        text,
  round       text,
  brand       text,
  created_at  timestamptz not null default now()
);
create index if not exists fh_requests_branch_idx  on public.fh_requests (branch);
create index if not exists fh_requests_course_idx  on public.fh_requests (course);
create index if not exists fh_requests_ts_idx      on public.fh_requests (ts desc);
create index if not exists fh_requests_session_idx on public.fh_requests (course, train_date, time_slot);
-- กันส่งซ้ำ: คนเดิม หลักสูตรเดิม รอบเดิม (เหมือนโปรเจกต์เดิม)
create unique index if not exists fh_requests_dup_idx
  on public.fh_requests (id_card, course, train_date, time_slot)
  where id_card is not null and id_card <> '';

create table if not exists public.fh_certificates (
  id              bigserial primary key,
  cert_name       text,
  course          text,
  train_date      text,
  expire_date     text,
  exp_status      text,
  emp_name        text,
  branch          text,
  position        text,
  sheet           text,
  match_type      text,
  emp_id          text default '',
  id_card         text default '',
  branch_at_train text default '',
  match_by        text default '',
  created_at      timestamptz not null default now()
);
create index if not exists fh_certificates_name_idx   on public.fh_certificates (cert_name);
create index if not exists fh_certificates_emp_idx    on public.fh_certificates (emp_name);
create index if not exists fh_certificates_branch_idx on public.fh_certificates (branch);
create index if not exists fh_certificates_exp_idx    on public.fh_certificates (expire_date);
create index if not exists fh_certificates_emp_id_idx on public.fh_certificates (emp_id);

-- ── ต้องล็อกอินก่อนถึงจะแตะข้อมูลได้ ──
alter table public.fh_requests     enable row level security;
alter table public.fh_certificates enable row level security;
drop policy if exists fh_requests_auth_all     on public.fh_requests;
drop policy if exists fh_certificates_auth_all on public.fh_certificates;
create policy fh_requests_auth_all     on public.fh_requests     for all to authenticated using (true) with check (true);
create policy fh_certificates_auth_all on public.fh_certificates for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.fh_requests, public.fh_certificates to authenticated;
grant usage, select on sequence public.fh_requests_id_seq, public.fh_certificates_id_seq to authenticated;
revoke all on public.fh_requests, public.fh_certificates from anon;
