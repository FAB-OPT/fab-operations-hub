-- =====================================================================
-- การตั้งค่าของฮับ → โปรเจกต์ FAB HUB (pzspcjqlxoqnbtvlfjsy)   17 ก.ย. 2569
-- รันที่: Supabase → โปรเจกต์ FAB HUB → SQL Editor → วางทั้งหมด → Run
--
-- ย้ายมาจาก fh_config ในโปรเจกต์ Training Record (cyjfgperenakjeazsfgf)
-- · ข้อมูลไม่ต้องคัดลอกเอง — เปิดฮับครั้งแรกหลังรันไฟล์นี้ ระบบคัดลอกให้ 1 ครั้ง
-- · fh_config เดิมไม่ถูกลบ และฮับยังเขียนสำเนาลงไปช่วงเปลี่ยนผ่าน (ย้อนกลับได้)
-- · ฮับมีคนเปิดทุกวัน → โปรเจกต์ FAB HUB ไม่ถูกหยุดเพราะไม่มีการใช้งานอีก
-- รันซ้ำได้ ไม่ทำข้อมูลหาย
-- =====================================================================

create table if not exists public.hub_config (
  key        text primary key,          -- systems · users · branches · jaedaengBranches · announcements · perms · brands
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ต้องล็อกอินก่อน (แอปล็อกอินแบบไม่ระบุตัวตนให้เอง) — เหมือนตารางอื่นใน lock-rls.sql
alter table public.hub_config enable row level security;
drop policy if exists hub_config_all_auth on public.hub_config;
create policy hub_config_all_auth on public.hub_config
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.hub_config to authenticated;
revoke all on public.hub_config from anon;

-- ตรวจผล: ควรเห็น 1 แถว rowsecurity = true
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'hub_config';
