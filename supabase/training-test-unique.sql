-- ════════════════════════════════════════════════════════════════════
-- แบบทดสอบก่อน–หลังอบรม — ให้ฐานข้อมูลบังคับ "ชื่อเดียว ช่วงเดียว ทำได้ครั้งเดียว"
--
-- ทำไมต้องมี: หน้าเว็บเช็กซ้ำให้แล้ว แต่ถ้า 2 เครื่องเลือกชื่อเดียวกันแล้วกดส่งในเสี้ยววินาทีเดียวกัน
--             ทั้งสองเครื่องอาจเช็กผ่านพร้อมกัน ตัวบังคับระดับฐานข้อมูลคือด่านสุดท้ายที่กันได้แน่นอน
--             (หน้าเว็บรองรับแล้ว: ถ้าฐานข้อมูลปฏิเสธ จะบอกว่า "ส่งไปแล้ว" ไม่ขึ้น error แดง)
--
-- วิธีใช้: Supabase (โปรเจกต์ FAB HUB) → SQL Editor → รันทีละขั้นตามลำดับ
-- ผลต่อข้อมูลเดิม: ขั้น 1 ดูอย่างเดียว · ขั้น 2 ลบเฉพาะแถวซ้ำ (เก็บแถวแรกสุดของแต่ละคน) · ขั้น 3 สร้างตัวบังคับ
-- ไม่แตะแถวของการประเมินอบรม (phase = 'eval') ซึ่งไม่ระบุชื่อและซ้ำได้
-- ════════════════════════════════════════════════════════════════════

-- ขั้น 1: ดูก่อนว่ามีคนทำซ้ำอยู่ไหม (ไม่ลบอะไร)
select training_key, phase, participant_id, participant_name, count(*) as ครั้ง,
       min(created_at) as ครั้งแรก, max(created_at) as ครั้งล่าสุด
from public.tr_attempts
where phase in ('pre','post') and participant_id <> ''
group by training_key, phase, participant_id, participant_name
having count(*) > 1
order by training_key, phase;

-- ขั้น 2: ถ้าขั้น 1 มีแถว → ลบแถวที่ซ้ำ เหลือแถวแรกสุดของแต่ละคนต่อช่วง
--         (ถ้าขั้น 1 ไม่มีแถวเลย ข้ามขั้นนี้ได้)
delete from public.tr_attempts a
using public.tr_attempts b
where a.phase in ('pre','post') and a.participant_id <> ''
  and a.training_key = b.training_key and a.phase = b.phase and a.participant_id = b.participant_id
  and a.id > b.id;

-- ขั้น 3: สร้างตัวบังคับ (ถ้ายังมีแถวซ้ำค้างอยู่ ขั้นนี้จะ error — กลับไปทำขั้น 2)
create unique index if not exists tr_attempts_once_idx
  on public.tr_attempts (training_key, phase, participant_id)
  where phase in ('pre','post') and participant_id <> '';

-- ตรวจผล: ควรเห็น 1 แถว
select indexname from pg_indexes where schemaname = 'public' and indexname = 'tr_attempts_once_idx';
