-- ════════════════════════════════════════════════════════════════════
-- แบบทดสอบก่อน–หลังอบรม — โหมด "ให้ผู้ใช้กรอกชื่อเอง" (จำกัดจำนวนคนได้)
--
-- วิธีใช้: Supabase (โปรเจกต์ FAB HUB) → SQL Editor → วางทั้งไฟล์ → Run (ครั้งเดียว รันซ้ำได้ไม่พัง)
-- ผลต่อข้อมูลเดิม: ไม่แตะอะไร · การอบรมที่มีอยู่ทุกรายการยังใช้รายชื่อแบบเดิม (ค่าเริ่มต้น = ไม่ใช่โหมดกรอกเอง)
--
-- self_entry = เปิดโหมดกรอกเอง (ไม่ต้องมีรายชื่อล่วงหน้า ผู้เข้าอบรมพิมพ์ชื่อตัวเอง)
-- self_limit = จำนวนคนสูงสุดที่ลงชื่อได้ในการอบรมนั้น
-- ════════════════════════════════════════════════════════════════════
alter table public.tr_trainings add column if not exists self_entry boolean not null default false;
alter table public.tr_trainings add column if not exists self_limit int     not null default 0;

-- ตรวจผล: ควรเห็น 2 แถว
select column_name, data_type, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'tr_trainings' and column_name in ('self_entry','self_limit');
