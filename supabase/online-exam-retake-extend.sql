-- ════════════════════════════════════════════════════════════════════
-- ระบบสอบออนไลน์ · แอดมินขยายเวลาสอบซ่อม
--
-- กติกาเดิม: ตกแล้วสอบใหม่ได้ 1 ครั้ง ภายใน 14 วัน (ค่าคงที่ OE_RETAKE_DAY ในหน้าเว็บ)
-- ฟังก์ชันนี้เก็บ "วันที่ขยายให้เพิ่ม" ไว้ที่ผลสอบรายใบ (data.retakeExtraDays)
-- พร้อมบันทึกว่าใครขยาย/เมื่อไหร่ — คนอื่นยังใช้ 14 วันเหมือนเดิม
--
-- วิธีใช้: Supabase → โปรเจกต์ FAB HUB (pzspcjqlxoqnbtvlfjsy) → SQL Editor
--          วางทั้งไฟล์นี้แล้วกด Run (รันซ้ำได้ ไม่พัง)
-- ════════════════════════════════════════════════════════════════════

create or replace function public.oe_extend_retake(
  p_submitted_at text, p_emp_id text default '', p_exam_id text default '',
  p_extra int default 0, p_by text default '')
returns jsonb language plpgsql as $$
declare v_want timestamptz := public._oe_ts(p_submitted_at); v_id bigint;
begin
  if coalesce(p_submitted_at, '') = '' then return jsonb_build_object('ok', false, 'error', 'no submittedAt'); end if;
  if v_want is null then return jsonb_build_object('ok', false, 'error', 'bad submittedAt'); end if;
  if p_extra is null or p_extra < 0 or p_extra > 365 then return jsonb_build_object('ok', false, 'error', 'bad days'); end if;
  select id into v_id from public.oe_results
   where not deleted and public._oe_ts(submitted_at) = v_want
     and (coalesce(p_emp_id, '') = '' or emp_id = btrim(p_emp_id))
     and (coalesce(p_exam_id, '') = '' or exam_id = btrim(p_exam_id))
   order by id desc limit 1;
  if v_id is null then return jsonb_build_object('ok', false, 'error', 'not found'); end if;
  update public.oe_results
     set data = data || jsonb_build_object('retakeExtraDays', p_extra, 'retakeExtBy', coalesce(p_by, ''), 'retakeExtAt', public._oe_now())
   where id = v_id;
  return jsonb_build_object('ok', true, 'extra', p_extra);
end $$;
