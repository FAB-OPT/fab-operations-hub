-- เปลี่ยนตำแหน่ง Restaurant General Manager → Restaurant Manager ในทะเบียนพนักงาน (11 ต.ค. 2569)
-- รันที่ Supabase โปรเจกต์ "Training Record" (SQL Editor) — ยังไม่ได้รัน ต้องให้ผู้ดูแลรันเอง
-- 1) ดูก่อนว่ากระทบกี่คน
select count(*) as will_change from public.fh_employees where position = 'Restaurant General Manager';
-- 2) เปลี่ยนจริง (เอา -- หน้าบรรทัดออกเมื่อพร้อม)
-- update public.fh_employees set position = 'Restaurant Manager' where position = 'Restaurant General Manager';
