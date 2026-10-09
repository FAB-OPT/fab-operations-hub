-- ════════════════════════════════════════════════════════════════════
-- แบบทดสอบก่อน–หลังอบรม — เลือก "ไม่ใช้แบบประเมินอบรม" ได้ทีละการอบรม
--
-- วิธีใช้: Supabase (โปรเจกต์ FAB HUB) → SQL Editor → วางทั้งไฟล์ → Run (ครั้งเดียว รันซ้ำได้ไม่พัง)
-- ผลต่อข้อมูลเดิม: ไม่แตะอะไร · การอบรมที่มีอยู่ทุกรายการยังใช้ประเมินเหมือนเดิม (ค่าเริ่มต้น = ใช้)
-- ════════════════════════════════════════════════════════════════════
alter table public.tr_trainings add column if not exists eval_enabled boolean not null default true;

-- ตรวจผล: ควรเห็น 1 แถว
select column_name, data_type, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'tr_trainings' and column_name = 'eval_enabled';
