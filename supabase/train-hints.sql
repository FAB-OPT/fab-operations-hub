-- ============================================================================
-- เชื่อม Customer Feedback Collection → ระบบการสอนงาน (Training Record)
-- ข้อร้องเรียน (VOC คะแนนต่ำ / Facebook) → คำแนะนำ Module + หัวข้อย่อยที่ควรสอน
--
-- วิธีใช้: เปิด Supabase โปรเจกต์ FAB HUB → SQL Editor → วางทั้งไฟล์แล้ว Run (รันซ้ำได้ ไม่ทำข้อมูลเดิมเสีย)
-- ต่อไป: deploy ฟังก์ชัน supabase/functions/analyze-complaints (ดู README ในโฟลเดอร์นั้น)
-- ============================================================================

-- 1) ตารางเก็บผลวิเคราะห์ (วิเคราะห์คอมเมนต์ละครั้งเดียว แล้วจำไว้ — ไม่เสียค่า AI ซ้ำ)
create table if not exists public.fb_train_hints (
  row_id bigint primary key references public.fb_rows(id) on delete cascade,
  modules jsonb not null default '[]'::jsonb,   -- [{ "id":"C004", "subs":["4.1 การย่างสเต็ก"] }]
  reason text not null default '',               -- เหตุผลสั้นๆ ภาษาไทย
  method text not null default 'rule',           -- 'ai' = วิเคราะห์ด้วย AI · 'rule' = ตามกฎคำสำคัญ
  analyzed_at timestamptz not null default now()
);
alter table public.fb_train_hints enable row level security;
-- ไม่เปิดสิทธิ์ตรงกับตาราง: ฟังก์ชัน analyze-complaints (service role) เป็นผู้เขียน · อ่านผ่าน RPC ด้านล่างเท่านั้น

-- 2) RPC: ข้อร้องเรียนของสาขา (รหัส 4 หลัก) ในช่วง p_days วัน + คำแนะนำที่วิเคราะห์ไว้แล้ว
--    เกณฑ์ข้อร้องเรียน: VOC คะแนน <= 6  หรือ  เคส Facebook · เฉพาะข้อมูลที่อนุมัติแล้ว (state = 'live')
create or replace function public.train_hints_for_branch(p_code text, p_days integer default 30)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.d desc, x.id desc), '[]'::jsonb)
  from (
    select r.id, r.channel, r.d, r.s, r.br, r.sub, r.main, r.c,
           h.modules, h.reason, h.method
    from public.fb_rows r
    left join public.fb_train_hints h on h.row_id = r.id
    where r.state = 'live'
      and r.d >= current_date - greatest(1, least(coalesce(p_days, 30), 120))
      and length(regexp_replace(coalesce(p_code, ''), '\D', '', 'g')) = 4
      and r.br like (regexp_replace(coalesce(p_code, ''), '\D', '', 'g') || ' %')
      and ((r.channel = 'voc' and r.s <= 6) or r.channel = 'facebook')
      and coalesce(trim(r.c), '') <> ''
    order by r.d desc, r.id desc
    limit 60
  ) x;
$$;
revoke all on function public.train_hints_for_branch(text, integer) from public, anon;
grant execute on function public.train_hints_for_branch(text, integer) to authenticated;   -- ผู้ใช้ที่ล็อกอินแบบ anonymous ของฮับนับเป็น authenticated

-- 3) ดัชนีให้ค้นตามสาขา+วันที่เร็ว (ตาราง fb_rows มี ~100,000 แถว)
create index if not exists fb_rows_branch_d_idx on public.fb_rows (br, d) where state = 'live';
