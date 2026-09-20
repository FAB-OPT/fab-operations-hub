-- ════════════════════════════════════════════════════════════════════
-- ระบบแบบฟอร์มออนไลน์ (ตัวสร้างฟอร์มทั่วไป)  —  modules/online-form.html
--
-- โปรเจกต์: FAB HUB (pzspcjqlxoqnbtvlfjsy)
-- วิธีใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้ ไม่พัง)
--
-- แยกจาก of_* ซึ่งตอนนี้เป็นของระบบ "ประเมินพนักงาน Silver / Gold" โดยเฉพาะ
-- ของเดิมฟอร์มทุกชุดถูกบังคับให้เป็นแบบประเมินรายบุคคล สเกล 1–5 ถ่วงน้ำหนักรายหมวด
-- ตารางชุดนี้ไม่มีเรื่องคะแนน — 1 ฟอร์มคือชุดคำถามหลายชนิด 1 แถวคือ 1 คำตอบ
--
-- 2 ตาราง
--   fm_forms     = ตัวแบบฟอร์ม (คำถาม · กลุ่มเป้าหมาย · ช่วงเวลาเปิด)
--   fm_responses = คำตอบที่ส่งเข้ามา
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.fm_forms (
  id               bigserial primary key,
  key              text unique not null,                  -- รหัสสั้นของฟอร์ม ใช้ผูกกับคำตอบ
  title            text not null,
  description      text not null default '',
  emoji            text not null default '📋',
  status           text not null default 'draft',         -- draft | open | closed
  -- คำถาม: [{ id, type, label, help, required, options[], min, max }]
  -- type: short | long | single | multi | scale | number | date | yesno
  questions        jsonb not null default '[]'::jsonb,
  -- ว่างทั้งคู่ = ทุกคนเห็น · ใส่ทั้งคู่ = ต้องเข้าเงื่อนไขทั้งคู่
  visible_brands   text[] not null default '{}',
  visible_branches text[] not null default '{}',
  once_per_user    boolean not null default true,         -- 1 คน (หรือ 1 สาขา) ตอบได้ครั้งเดียว
  open_at          timestamptz,                           -- ว่าง = ไม่จำกัด
  close_at         timestamptz,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.fm_responses (
  id                bigserial primary key,
  form_key          text not null,
  form_title        text not null default '',             -- เก็บชื่อ ณ ตอนตอบ เผื่อฟอร์มถูกแก้ทีหลัง
  answers           jsonb not null default '{}'::jsonb,   -- { <question id>: value }
  respondent_code   text not null default '',             -- รหัสผู้ใช้จากฮับ
  respondent_name   text not null default '',
  respondent_role   text not null default '',
  respondent_branch text not null default '',
  respondent_brand  text not null default '',
  created_at        timestamptz not null default now()
);

create index if not exists fm_responses_form_idx on public.fm_responses (form_key, created_at desc);
create index if not exists fm_responses_who_idx  on public.fm_responses (form_key, respondent_code);

-- ── ต้องล็อกอินก่อนถึงจะแตะข้อมูลได้ (เหมือนตารางอื่นใน lock-rls.sql) ──
alter table public.fm_forms     enable row level security;
alter table public.fm_responses enable row level security;

drop policy if exists fm_forms_all_auth on public.fm_forms;
create policy fm_forms_all_auth on public.fm_forms
  for all to authenticated using (true) with check (true);

drop policy if exists fm_resp_all_auth on public.fm_responses;
create policy fm_resp_all_auth on public.fm_responses
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.fm_forms     to authenticated;
grant select, insert, update, delete on public.fm_responses to authenticated;
grant usage, select on sequence public.fm_forms_id_seq     to authenticated;
grant usage, select on sequence public.fm_responses_id_seq to authenticated;
revoke all on public.fm_forms     from anon;
revoke all on public.fm_responses from anon;

-- ตรวจผล: ควรเห็น 2 แถว rowsecurity = true
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in ('fm_forms','fm_responses');
