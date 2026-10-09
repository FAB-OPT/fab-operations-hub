-- ════════════════════════════════════════════════════════════════════
-- รวมระบบประเมินพนักงาน Silver / Gold เข้าตารางฟอร์มทั่วไป (fm_*) — ขั้นที่ 1: คัดลอก
--
-- วิธีใช้: Supabase (โปรเจกต์ FAB HUB) → SQL Editor → วางทั้งไฟล์ → Run
--   รันซ้ำได้ ไม่พัง · รันซ้ำก่อนสลับระบบเพื่อดึงผลที่กรอกเพิ่มเข้ามาทีหลัง
--
-- ไฟล์นี้ "ไม่ลบ ไม่แก้" ตาราง of_forms / of_responses / of_people เลย
--   · ของเดิมยังเป็นตัวที่หน้าเว็บใช้อยู่จนกว่าคุณจะสลับ (ดูท้ายไฟล์)
--   · ฟอร์มที่คัดลอกเข้า fm_forms มี kind = 'assess' หน้าฟอร์มทั่วไปจะไม่แสดงมัน
--   · รายชื่อพนักงาน (of_people) ยังใช้ตารางเดิม ไม่ย้าย
--
-- ลำดับที่ปลอดภัย
--   1) รันไฟล์นี้ → ดูผลตรวจท้ายไฟล์ว่าตัวเลขเก่า/ใหม่ตรงกัน
--   2) เปิดหน้า silver-gold.html?store=fm ทดสอบดูผล/กรอก/ลบ (สลับเฉพาะเครื่องคุณ)
--   3) พอมั่นใจ แจ้งให้เปลี่ยนค่าตั้งต้นในโค้ดเป็น fm ทุกเครื่อง
--   4) กลับ of_* ได้ตลอดด้วย ?store=of (ผลที่กรอกหลังสลับจะอยู่ใน fm_* เท่านั้น)
-- ════════════════════════════════════════════════════════════════════

-- ── 0) ให้ of_forms มีคอลัมน์ครบ (ถ้าเคยรัน online-form-visibility.sql แล้วจะไม่มีผลอะไร) ──
alter table public.of_forms
  add column if not exists visible_brands       text[]  not null default '{}',
  add column if not exists visible_branches     text[]  not null default '{}',
  add column if not exists show_score_to_rater  boolean not null default false,
  add column if not exists show_score_to_branch boolean not null default false;

-- ── 1) fm_forms: เพิ่มความสามารถของแบบประเมินรายบุคคล ──
alter table public.fm_forms
  add column if not exists kind                 text    not null default 'survey',  -- survey = แบบสอบถามทั่วไป · assess = ประเมินพนักงาน
  add column if not exists round                text    not null default '',
  add column if not exists subject_required     boolean not null default false,
  add column if not exists subject_filter       jsonb   not null default '{}'::jsonb,
  add column if not exists scale                jsonb   not null default '[]'::jsonb,
  add column if not exists sections             jsonb   not null default '[]'::jsonb,
  add column if not exists closing              jsonb   not null default '[]'::jsonb,
  add column if not exists rules                jsonb   not null default '{}'::jsonb,
  add column if not exists show_score_to_rater  boolean not null default false,
  add column if not exists show_score_to_branch boolean not null default false;

create index if not exists fm_forms_kind_idx on public.fm_forms (kind);

-- ── 2) fm_responses: เพิ่มช่องผู้ถูกประเมิน + คะแนน ──
alter table public.fm_responses
  add column if not exists form_kind      text    not null default 'survey',
  add column if not exists round          text    not null default '',
  add column if not exists subject_id     bigint  not null default 0,
  add column if not exists subject_name   text    not null default '',
  add column if not exists subject_branch text    not null default '',
  add column if not exists subject_meta   jsonb   not null default '{}'::jsonb,
  add column if not exists sections       jsonb   not null default '{}'::jsonb,
  add column if not exists total_pct      numeric,
  add column if not exists avg_score      numeric,
  add column if not exists verdict        text    not null default '',
  add column if not exists verdict_note   text    not null default '',
  add column if not exists texts          jsonb   not null default '{}'::jsonb;

create index if not exists fm_resp_kind_idx on public.fm_responses (form_kind, form_key);

-- กฎ "ผู้กรอก 1 คน ต่อ ผู้ถูกประเมิน 1 คน ต่อ ฟอร์ม ต่อ รอบ = 1 ครั้ง" เหมือนของเดิม (of_resp_once)
-- ใช้เฉพาะแบบประเมิน — แบบสอบถามทั่วไปยังคุมที่หน้าเว็บตามเดิม
create unique index if not exists fm_resp_assess_once
  on public.fm_responses (form_key, round, respondent_code, subject_id)
  where form_kind = 'assess';

-- ── 3) คัดลอกตัวแบบฟอร์ม (key เดิม · ไม่ทับของที่มีแล้ว) ──
insert into public.fm_forms
  (key, title, description, emoji, status, kind, round, subject_required, subject_filter,
   scale, sections, closing, rules, visible_brands, visible_branches,
   show_score_to_rater, show_score_to_branch, once_per_user, sort_order, created_at, updated_at)
select o.key, o.title, coalesce(o.description,''), coalesce(o.emoji,'📋'), o.status, 'assess', coalesce(o.round,''),
       o.subject_required, o.subject_filter, o.scale, o.sections, o.closing, o.rules,
       o.visible_brands, o.visible_branches, o.show_score_to_rater, o.show_score_to_branch,
       true, o.sort_order, o.created_at, o.updated_at
from public.of_forms o
on conflict (key) do nothing;

-- ── 4) คัดลอกผลที่กรอกแล้ว (เก็บเวลาเดิม · รันซ้ำไม่ซ้ำแถว) ──
insert into public.fm_responses
  (form_key, form_title, form_kind, round, answers,
   respondent_code, respondent_name, respondent_role, respondent_branch, respondent_brand,
   subject_id, subject_name, subject_branch, subject_meta,
   sections, total_pct, avg_score, verdict, verdict_note, texts, created_at)
select o.form_key, coalesce(o.form_title,''), 'assess', coalesce(o.round,''), o.answers,
       o.rater_key, coalesce(o.rater_name,''), coalesce(o.rater_role,''), coalesce(o.rater_branch,''), '',
       o.subject_id, coalesce(o.subject_name,''), coalesce(o.subject_branch,''), o.subject_meta,
       o.sections, o.total_pct, o.avg_score, coalesce(o.verdict,''), coalesce(o.verdict_note,''), o.texts, o.created_at
from public.of_responses o
where exists (select 1 from public.fm_forms f where f.key = o.form_key and f.kind = 'assess')
  and not exists (
    select 1 from public.fm_responses r
    where r.form_kind = 'assess' and r.form_key = o.form_key and r.round = coalesce(o.round,'')
      and r.respondent_code = o.rater_key and r.subject_id = o.subject_id);

-- ════════════════════════════════════════════════════════════════════
-- ตรวจผล — ดูผลของ 3 คำสั่งนี้ (เลือกแล้ว Run ทีละอัน หรือทั้งหมดก็ได้)
-- ════════════════════════════════════════════════════════════════════

-- ก) จำนวนต้องเท่ากันทั้งสองฝั่ง (ต่าง = มีฟอร์ม/ผลที่ยังไม่ถูกคัดลอก)
select 'ฟอร์ม'  as รายการ, (select count(*) from public.of_forms)     as เดิม,
       (select count(*) from public.fm_forms where kind = 'assess')     as ใหม่
union all
select 'ผลที่กรอก', (select count(*) from public.of_responses),
       (select count(*) from public.fm_responses where form_kind = 'assess');

-- ข) เทียบคะแนนรายฟอร์ม — ค่าเฉลี่ยและผลรวมต้องตรงกัน
select 'เดิม' as ฝั่ง, form_key, count(*) as ใบ, round(avg(total_pct)::numeric, 2) as เฉลี่ย, sum(total_pct) as รวม
  from public.of_responses group by form_key
union all
select 'ใหม่', form_key, count(*), round(avg(total_pct)::numeric, 2), sum(total_pct)
  from public.fm_responses where form_kind = 'assess' group by form_key
order by form_key, ฝั่ง;

-- ค) key ฟอร์มที่ชนกับแบบสอบถามทั่วไปเดิม (ต้องไม่มีแถว — ถ้ามี แจ้งให้แก้ key ก่อนสลับ)
select o.key from public.of_forms o
join public.fm_forms f on f.key = o.key and f.kind <> 'assess';
