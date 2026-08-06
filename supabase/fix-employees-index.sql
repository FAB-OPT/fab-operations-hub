-- ═══════════════════════════════════════════════════════════════
--  แก้ปัญหา: ย้ายทะเบียนพนักงานไม่ได้
--  duplicate key value violates unique constraint "fh_employees_empid_idx"
--
--  สาเหตุ: ตอนออกแบบตั้ง emp_id เป็น unique ไว้
--          แต่ทะเบียนจริงมีรหัสซ้ำ 230 รหัส (เกินมา 240 แถว จาก 1,674)
--          ส่วนใหญ่คนเดียวกันถูกใส่ 2 ครั้งเพราะชื่อสาขาพิมพ์ต่างกัน
--          แต่บางเคสเป็นคนละคนใช้รหัสเดียวกันจริง — ตัดทิ้งอัตโนมัติไม่ได้
--
--  วิธีใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run → แล้วกด "ย้ายข้อมูลทั้งหมด" ใหม่
-- ═══════════════════════════════════════════════════════════════

-- เปลี่ยนจาก unique เป็น index ธรรมดา (ค้นหาเร็วเหมือนเดิม แต่ไม่บล็อกข้อมูลซ้ำ)
drop index if exists public.fh_employees_empid_idx;
create index if not exists fh_employees_empid_idx on public.fh_employees (emp_id);

-- ล้างของค้างจากรอบที่ล้มเหลว (ถ้ามี) เพื่อให้ย้ายใหม่ได้สะอาด
truncate table public.fh_employees;

-- ตรวจผล — ควรได้ 0 แถว พร้อมให้ย้ายใหม่
select count(*) as fh_employees_rows from public.fh_employees;
