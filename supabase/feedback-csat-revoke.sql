-- ═════════════════════════════════════════════════════════════════════
-- ถอน/อนุมัติ "เฉพาะ CSAT/NPS" ของชุดเดียวกัน โดยคอมเมนต์ยังอยู่ในระบบ
-- ต้องรันหลัง supabase/feedback.sql (ไฟล์เดิม) · รันซ้ำได้ ไม่พัง
--
-- สถานะชุดใหม่ 'partial' = คอมเมนต์ลงระบบแล้ว แต่ CSAT/NPS ถูกถอนออกไป
--   (ชุดที่ถอนทั้งหมด → 'staging' เหมือนเดิม)
--
-- วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > Run
-- ═════════════════════════════════════════════════════════════════════

-- 1) เพิ่มสถานะ partial ให้ fb_batches
alter table public.fb_batches drop constraint if exists fb_batches_status_check;
alter table public.fb_batches add constraint fb_batches_status_check
  check (status in ('staging', 'approved', 'partial'));

-- 2) ถอนเฉพาะ CSAT/NPS ของชุดนี้ (คอมเมนต์ไม่แตะ)
create or replace function public.fb_revoke_csat(p_batch uuid)
returns jsonb language plpgsql as $$
declare v_n int; v_rows_live boolean;
begin
  if not exists (select 1 from public.fb_batches where id = p_batch and status in ('approved', 'partial') for update) then
    return jsonb_build_object('ok', false, 'error', 'ชุดนี้ยังไม่ได้อนุมัติหรือไม่พบ');
  end if;
  update public.fb_csat set state = 'staging', updated_at = now() where batch_id = p_batch and state = 'live';
  get diagnostics v_n = row_count;
  select exists(select 1 from public.fb_rows where batch_id = p_batch and state = 'live') into v_rows_live;
  update public.fb_batches
     set status = case when v_rows_live then 'partial' else 'staging' end,
         approved_by = case when v_rows_live then approved_by else '' end,
         approved_at = case when v_rows_live then approved_at else null end
   where id = p_batch;
  return jsonb_build_object('ok', true, 'n', v_n, 'rows_still_live', v_rows_live);
end $$;

-- 3) อนุมัติ CSAT/NPS ที่ค้างอยู่ของชุดที่ถอนเฉพาะ CSAT ไปแล้ว (status = partial)
create or replace function public.fb_approve_csat(p_batch uuid, p_by text default '')
returns jsonb language plpgsql as $$
declare v_n int;
begin
  if not exists (select 1 from public.fb_batches where id = p_batch and status = 'partial' for update) then
    return jsonb_build_object('ok', false, 'error', 'ชุดนี้ไม่ได้อยู่ในสถานะ CSAT/NPS ถอนออก');
  end if;
  update public.fb_csat set state = 'live', updated_at = now() where batch_id = p_batch and state = 'staging';
  get diagnostics v_n = row_count;
  update public.fb_batches set status = 'approved', approved_by = p_by, approved_at = now() where id = p_batch;
  return jsonb_build_object('ok', true, 'n', v_n);
end $$;

-- 4) ถอนการอนุมัติทั้งชุด ให้ใช้ได้กับสถานะ partial ด้วย (เดิมใช้ได้เฉพาะ approved)
create or replace function public.fb_revoke(p_batch uuid)
returns jsonb language plpgsql as $$
begin
  if not exists (select 1 from public.fb_batches where id = p_batch and status in ('approved', 'partial') for update) then
    return jsonb_build_object('ok', false, 'error', 'ชุดนี้ยังไม่ได้อนุมัติหรือไม่พบ');
  end if;
  update public.fb_rows set state = 'staging', updated_at = now() where batch_id = p_batch and state = 'live';
  update public.fb_csat set state = 'staging', updated_at = now() where batch_id = p_batch and state = 'live';
  update public.fb_batches set status = 'staging', approved_by = '', approved_at = null where id = p_batch;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fb_revoke_csat(uuid)              from public, anon;
revoke all on function public.fb_approve_csat(uuid, text)       from public, anon;
revoke all on function public.fb_revoke(uuid)                   from public, anon;
grant execute on function public.fb_revoke_csat(uuid)           to authenticated;
grant execute on function public.fb_approve_csat(uuid, text)    to authenticated;
grant execute on function public.fb_revoke(uuid)                to authenticated;
