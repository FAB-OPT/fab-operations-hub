-- ═════════════════════════════════════════════════════════════════════
-- CSAT / NPS รายสาขา (ไฟล์ Ranking) — เก็บรายสาขาแยกต่อเดือน
-- ต้องรันหลัง supabase/feedback.sql · รันซ้ำได้ ไม่พัง
--
-- ไฟล์ Ranking ไม่มีคอลัมน์เดือน ผู้นำเข้าเลือกเดือนเอง
-- บันทึกแล้วลงระบบทันที (ไม่มีขั้นอนุมัติ) เดือนเดียวกันที่เคยบันทึกจะถูกแทนที่
--
-- วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > Run
-- ═════════════════════════════════════════════════════════════════════

-- ── 1) ตารางเก็บคะแนนรายสาขา ──
create table if not exists public.fb_branch_csat (
  month       text not null,                 -- 'YYYY-MM'
  code        text not null,                 -- รหัสสาขา 4 หลัก (Location_Meta2)
  name        text not null default '',
  csat        numeric,
  nps         numeric,
  rank        int,
  src_file    text not null default '',
  updated_at  timestamptz not null default now(),
  primary key (month, code)
);

-- ── 2) สิทธิ์ (ตามแบบเดียวกับตาราง fb_* เดิม: ผู้ล็อกอินอ่าน/เขียนได้) ──
alter table public.fb_branch_csat enable row level security;
drop policy if exists fb_branch_csat_all_auth on public.fb_branch_csat;
create policy fb_branch_csat_all_auth on public.fb_branch_csat for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.fb_branch_csat to authenticated;
revoke all on public.fb_branch_csat from anon;

-- ── 3) บันทึกทั้งเดือนในครั้งเดียว (แทนของเดิมของเดือนนั้น) ──
create or replace function public.fb_ranking_save(p_month text, p_file text, p_rows jsonb)
returns jsonb language plpgsql as $$
declare v_n int;
begin
  if p_month !~ '^\d{4}-\d{2}$' then
    return jsonb_build_object('ok', false, 'error', 'รูปแบบเดือนไม่ถูกต้อง');
  end if;
  delete from public.fb_branch_csat where month = p_month;
  insert into public.fb_branch_csat (month, code, name, csat, nps, rank, src_file, updated_at)
  select p_month, x->>'code', coalesce(x->>'name', ''),
         nullif(x->>'cs', '')::numeric, nullif(x->>'np', '')::numeric, nullif(x->>'rank', '')::int,
         coalesce(p_file, ''), now()
    from jsonb_array_elements(p_rows) x;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'n', v_n);
end $$;

grant execute on function public.fb_ranking_save(text, text, jsonb) to authenticated;
