-- ════════════════════════════════════════════════════════════════════
-- รวมแบบทดสอบก่อน–หลังอบรมเข้าตารางฟอร์มทั่วไป (fm_*) — ขั้นที่ 1: คัดลอก
--
-- วิธีใช้: Supabase (โปรเจกต์ FAB HUB) → SQL Editor → วางทั้งไฟล์ → Run
--   ต้องรัน unify-assess-step1.sql มาก่อนแล้ว (ไฟล์นี้ใช้คอลัมน์ kind / form_kind ที่ไฟล์นั้นสร้าง)
--   รันซ้ำได้ ไม่พัง · รันซ้ำก่อนสลับระบบเพื่อดึงผลที่ทำเพิ่มเข้ามาทีหลัง
--
-- ไฟล์นี้ "ไม่ลบ ไม่แก้" ตาราง tr_trainings / tr_attempts เลย
--   · ของเดิมยังเป็นตัวที่หน้าเว็บใช้อยู่จนกว่าจะสลับ (ดูท้ายไฟล์)
--   · การอบรมที่คัดลอกเข้า fm_forms มี kind = 'quiz' · ผลที่ทำมี form_kind = 'quiz'
--     หน้าแบบสอบถามทั่วไปจะไม่แสดงมัน
--
-- ลำดับที่ปลอดภัย
--   1) รันไฟล์นี้ → ดูผลตรวจท้ายไฟล์ว่าตัวเลขเก่า/ใหม่ตรงกัน
--   2) เปิดหน้า training-test.html?store=fm ทดสอบ (สลับเฉพาะเครื่องคุณ) — ดูผล · ทำ 1 ใบ · ลบใบนั้น
--   3) พอมั่นใจ แจ้งให้เปลี่ยนค่าตั้งต้นในโค้ดเป็น fm ทุกเครื่อง
--   4) กลับของเดิมได้ตลอดด้วย ?store=tr (ผลที่ทำหลังสลับจะอยู่ใน fm_* เท่านั้น)
-- ════════════════════════════════════════════════════════════════════

-- ── 0) ให้ tr_trainings มีคอลัมน์ครบ (รันไฟล์ eval-toggle / self-entry มาแล้วจะไม่มีผลอะไร) ──
alter table public.tr_trainings
  add column if not exists source       jsonb,
  add column if not exists eval_enabled boolean not null default true,
  add column if not exists self_entry   boolean not null default false,
  add column if not exists self_limit   int     not null default 0;

-- ── 1) fm_forms: เพิ่มช่องของแบบทดสอบอบรม ──
alter table public.fm_forms
  add column if not exists train_date   date,
  add column if not exists place        text    not null default '',
  add column if not exists trainer      text    not null default '',
  add column if not exists participants jsonb   not null default '[]'::jsonb,
  add column if not exists pre_open     boolean not null default true,
  add column if not exists post_open    boolean not null default false,
  add column if not exists source       jsonb,
  add column if not exists eval_enabled boolean not null default true,
  add column if not exists self_entry   boolean not null default false,
  add column if not exists self_limit   int     not null default 0;

-- ── 2) fm_responses: เพิ่มช่องผู้ทำแบบทดสอบ + คะแนน ──
alter table public.fm_responses
  add column if not exists phase              text    not null default '',   -- pre | post | eval
  add column if not exists participant_id     text    not null default '',
  add column if not exists participant_name   text    not null default '',
  add column if not exists participant_branch text    not null default '',
  add column if not exists score              int     not null default 0,
  add column if not exists total              int     not null default 0,
  add column if not exists pct                numeric not null default 0;

create index if not exists fm_resp_quiz_idx
  on public.fm_responses (form_key, phase) where form_kind = 'quiz';

-- ── 3) คัดลอกการอบรม (key เดิม · ไม่ทับของที่มีแล้ว) ──
insert into public.fm_forms
  (key, title, description, emoji, status, kind, questions, participants,
   train_date, place, trainer, pre_open, post_open, source, eval_enabled, self_entry, self_limit,
   visible_brands, visible_branches, once_per_user, sort_order, created_at, updated_at)
select t.key, t.title, coalesce(t.description,''), coalesce(t.emoji,'🎓'), t.status, 'quiz', t.questions, t.participants,
       t.train_date, coalesce(t.place,''), coalesce(t.trainer,''), t.pre_open, t.post_open, t.source,
       t.eval_enabled, t.self_entry, t.self_limit,
       t.visible_brands, t.visible_branches, false, t.sort_order, t.created_at, t.updated_at
from public.tr_trainings t
on conflict (key) do nothing;

-- ── 4) คัดลอกผลที่ทำแล้ว (เก็บเวลาเดิม · รันซ้ำไม่ซ้ำแถว) ──
--     ตัดแถวซ้ำของชื่อเดียวกัน/ช่วงเดียวกันออกเอง (ตัวบังคับด้านล่างไม่ยอมให้ซ้ำ) เก็บแถวแรกสุด
insert into public.fm_responses
  (form_key, form_title, form_kind, phase, participant_id, participant_name, participant_branch,
   answers, score, total, pct,
   respondent_code, respondent_name, respondent_branch, created_at)
select a.training_key, coalesce(a.training_title,''), 'quiz', a.phase, a.participant_id, a.participant_name, a.participant_branch,
       a.answers, a.score, a.total, a.pct,
       a.taker_code, a.taker_name, a.taker_branch, a.created_at
from public.tr_attempts a
where exists (select 1 from public.fm_forms f where f.key = a.training_key and f.kind = 'quiz')
  and not exists (
    select 1 from public.fm_responses r
    where r.form_kind = 'quiz' and r.form_key = a.training_key and r.phase = a.phase
      and r.participant_id = a.participant_id and r.respondent_code = a.taker_code
      and r.created_at = a.created_at)
  and not (a.phase in ('pre','post') and a.participant_id <> '' and exists (
    select 1 from public.tr_attempts b
    where b.training_key = a.training_key and b.phase = a.phase and b.participant_id = a.participant_id
      and b.id < a.id));

-- ตัวบังคับ "ชื่อเดียว ช่วงเดียว ทำได้ครั้งเดียว" (เหมือน tr_attempts_once_idx) — ไม่นับการประเมินอบรม (eval)
create unique index if not exists fm_resp_quiz_once
  on public.fm_responses (form_key, phase, participant_id)
  where form_kind = 'quiz' and phase in ('pre','post') and participant_id <> '';

-- ════════════════════════════════════════════════════════════════════
-- ตรวจผล — เลือกทีละคำสั่งแล้ว Run (Supabase แสดงผลเฉพาะคำสั่งสุดท้ายที่เลือก)
-- ════════════════════════════════════════════════════════════════════

-- ก) จำนวนต้องเท่ากัน (ผลที่ทำ: "เดิม" ที่มากกว่า = แถวซ้ำที่ตัดทิ้งตามข้อ 4 ดูคำสั่ง ง)
select 'การอบรม' as รายการ, (select count(*) from public.tr_trainings) as เดิม,
       (select count(*) from public.fm_forms where kind = 'quiz') as ใหม่
union all
select 'ผลที่ทำ', (select count(*) from public.tr_attempts),
       (select count(*) from public.fm_responses where form_kind = 'quiz');

-- ข) เทียบคะแนนรายการอบรมและช่วง — จำนวน/ผลรวม/ค่าเฉลี่ยต้องตรงกัน
select 'เดิม' as ฝั่ง, training_key as การอบรม, phase as ช่วง, count(*) as ใบ, sum(score) as คะแนนรวม, round(avg(pct)::numeric, 2) as เฉลี่ย
  from public.tr_attempts group by training_key, phase
union all
select 'ใหม่', form_key, phase, count(*), sum(score), round(avg(pct)::numeric, 2)
  from public.fm_responses where form_kind = 'quiz' group by form_key, phase
order by การอบรม, ช่วง, ฝั่ง;

-- ค) key การอบรมที่ชนกับฟอร์มอื่นใน fm_forms (ต้องไม่มีแถว)
select t.key from public.tr_trainings t
join public.fm_forms f on f.key = t.key and f.kind <> 'quiz';

-- ง) แถวทำซ้ำใน tr_attempts ที่ไม่ถูกคัดลอก (ชื่อเดียวกัน ช่วงเดียวกัน) — ถ้ามีคือของเดิมซ้ำอยู่แล้ว
select training_key, phase, participant_id, participant_name, count(*) as ครั้ง
from public.tr_attempts
where phase in ('pre','post') and participant_id <> ''
group by training_key, phase, participant_id, participant_name
having count(*) > 1;
