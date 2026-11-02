-- ขั้น 0: นับแถวและขนาดของทุกตารางในโปรเจกต์นี้ (อ่านอย่างเดียว ไม่แก้ข้อมูล)
-- วิธีใช้: เปิด Supabase > SQL Editor ในแต่ละโปรเจกต์ แล้วรันทีละโปรเจกต์
-- โปรเจกต์ที่ต้องรัน: cyjfgperenakjeazsfgf (Training Record), pzspcjqlxoqnbtvlfjsy (FAB HUB),
--                     OPT-ALL, Sales-Report-2.0

select
  t.table_name,
  (xpath('/row/c/text()',
         query_to_xml(format('select count(*) as c from public.%I', t.table_name), false, true, '')))[1]::text::bigint as row_count,
  pg_size_pretty(pg_total_relation_size(format('public.%I', t.table_name)::regclass)) as size
from information_schema.tables t
where t.table_schema = 'public'
  and t.table_type = 'BASE TABLE'
order by t.table_name;
