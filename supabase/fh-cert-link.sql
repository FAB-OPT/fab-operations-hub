-- ═══════════════════════════════════════════════════════════════
-- ใบรับรอง: เพิ่มคอลัมน์ตัวชี้ไปหาคนในทะเบียน
--
-- ทำไมต้องมี: ใบรับรองเคยผูกกับคนด้วย "ชื่อ" อย่างเดียว พอคนเปลี่ยนนามสกุล
-- การผูกจะขาดถาวร และย้ายสาขาเมื่อไร ใบก็ยังค้างสาขาเก่าอยู่
-- ตอนนี้ผูกด้วยรหัสพนักงานแทน แล้วดึงชื่อ/สาขา/ตำแหน่งจากทะเบียนล่าสุดทุกครั้ง
--
-- สาขาตอนอบรม เก็บแยกไว้เป็นประวัติ ไม่ตามคนไป
-- "สาขานี้มีคนมีใบรับรองกี่คน" กับ "สาขานี้ส่งคนไปอบรมกี่คน" เป็นคนละคำถาม
--
-- จับคู่โดย: auto = ระบบจับให้ · near = ชื่อสะกดต่างนิดเดียว ควรตรวจซ้ำ
--            manual = คนจับคู่เอง (ระบบห้ามเปลี่ยนตัวคนทีหลัง)
--
-- วิธีใช้: เปิด Supabase → SQL Editor → วางทั้งไฟล์ → Run
-- รันซ้ำได้ ไม่พัง (IF NOT EXISTS)
-- ═══════════════════════════════════════════════════════════════

alter table public.fh_certificates add column if not exists emp_id          text default '';
alter table public.fh_certificates add column if not exists id_card         text default '';
alter table public.fh_certificates add column if not exists branch_at_train text default '';
alter table public.fh_certificates add column if not exists match_by        text default '';

-- ค้นใบของคนคนหนึ่งบ่อยกว่าค้นด้วยอย่างอื่น
create index if not exists fh_certificates_emp_id_idx on public.fh_certificates (emp_id);

-- ตรวจว่าเพิ่มครบแล้ว
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'fh_certificates'
order by ordinal_position;
