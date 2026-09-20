-- ════════════════════════════════════════════════════════════════════
-- ระบบแบบทดสอบก่อน–หลังอบรม  —  modules/training-test.html
--
-- โปรเจกต์: FAB HUB (pzspcjqlxoqnbtvlfjsy)
-- วิธีใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้ ไม่พัง)
--
-- แยกจากระบบสอบวัดผล (online-exam) โดยสิ้นเชิง เพราะคนละกติกากัน
--   ระบบสอบวัดผล  — มีเกณฑ์ผ่าน · ขอสิทธิ์สอบ · สอบซ่อม · ตัดสินผ่าน/ไม่ผ่าน
--   ระบบนี้        — ไม่มีผ่าน/ไม่ผ่าน เก็บแค่ "ก่อนเรียนได้กี่คะแนน หลังเรียนได้กี่คะแนน"
--                    ใช้ชุดคำถามเดียวกันทั้งก่อนและหลัง จึงเทียบกันได้ตรง ๆ
--
-- 2 ตาราง
--   tr_trainings = การอบรม 1 ครั้ง (ชุดคำถาม · รายชื่อผู้เข้าอบรม · ช่วงที่เปิดให้ทำ)
--   tr_attempts  = การทำแบบทดสอบ 1 ครั้ง (ก่อน หรือ หลัง)
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.tr_trainings (
  id               bigserial primary key,
  key              text unique not null,
  title            text not null,                          -- ชื่อหลักสูตร
  description      text not null default '',
  emoji            text not null default '🎓',
  train_date       date,                                   -- วันที่อบรม
  place            text not null default '',
  trainer          text not null default '',               -- วิทยากร
  status           text not null default 'draft',          -- draft | open | closed
  -- คำถาม: [{ id, label, choices:[...], answer: <index ของข้อที่ถูก> ]
  questions        jsonb not null default '[]'::jsonb,
  -- ผู้เข้าอบรม: [{ id, name, branch, position }] — ผู้ทำเลือกชื่อตัวเองจากรายการนี้
  participants     jsonb not null default '[]'::jsonb,
  pre_open         boolean not null default true,          -- เปิดให้ทำแบบทดสอบก่อนเรียน
  post_open        boolean not null default false,         -- เปิดให้ทำแบบทดสอบหลังเรียน
  visible_brands   text[] not null default '{}',
  visible_branches text[] not null default '{}',
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.tr_attempts (
  id             bigserial primary key,
  training_key   text not null,
  training_title text not null default '',
  phase          text not null,                            -- pre | post
  participant_id text not null default '',                 -- id ในรายชื่อผู้เข้าอบรม
  participant_name   text not null default '',
  participant_branch text not null default '',
  answers        jsonb not null default '{}'::jsonb,        -- { <question id>: <index ที่เลือก> }
  score          int  not null default 0,                  -- ตอบถูกกี่ข้อ
  total          int  not null default 0,                  -- จากกี่ข้อ
  pct            numeric(5,1) not null default 0,
  taker_code     text not null default '',                 -- บัญชีที่ใช้ทำ (จากฮับ)
  taker_name     text not null default '',
  taker_branch   text not null default '',
  created_at     timestamptz not null default now()
);

create index if not exists tr_attempts_key_idx  on public.tr_attempts (training_key, phase);
create index if not exists tr_attempts_who_idx  on public.tr_attempts (training_key, participant_id);

-- ── ต้องล็อกอินก่อนถึงจะแตะข้อมูลได้ ──
alter table public.tr_trainings enable row level security;
alter table public.tr_attempts  enable row level security;

drop policy if exists tr_trainings_all_auth on public.tr_trainings;
create policy tr_trainings_all_auth on public.tr_trainings
  for all to authenticated using (true) with check (true);

drop policy if exists tr_attempts_all_auth on public.tr_attempts;
create policy tr_attempts_all_auth on public.tr_attempts
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.tr_trainings to authenticated;
grant select, insert, update, delete on public.tr_attempts  to authenticated;
grant usage, select on sequence public.tr_trainings_id_seq to authenticated;
grant usage, select on sequence public.tr_attempts_id_seq  to authenticated;
revoke all on public.tr_trainings from anon;
revoke all on public.tr_attempts  from anon;

-- ตรวจผล: ควรเห็น 2 แถว rowsecurity = true
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in ('tr_trainings','tr_attempts');
