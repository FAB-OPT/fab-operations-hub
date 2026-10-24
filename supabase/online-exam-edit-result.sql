-- ════════════════════════════════════════════════════════════════════
-- ระบบสอบออนไลน์ · แอดมินแก้ผลสอบรายข้อ (ตรวจใหม่ / เฉลยผิด)
--
-- หน้าผลสอบ → เปิดใบ → "✏️ แก้ผลรายข้อ" → กดถูก/ผิดรายข้อ → ใส่เหตุผล → บันทึก
-- ฟังก์ชันนี้รับ "ส่วนที่แก้" แล้วผสานลงผลสอบใบเดิม (data) — เฉพาะช่องที่อนุญาตด้านล่างเท่านั้น
--   answers · correct · pct · pass · result · parts
--   origCorrect · origPct · origResult · origPass (ค่าก่อนแก้ครั้งแรก เก็บไว้ย้อนดู)
--   editedBy · editedAt · editNote · editCount
-- ช่องอื่น (ชื่อ · รหัส · เวลาส่ง · ชุดข้อสอบ ฯลฯ) แก้ผ่านทางนี้ไม่ได้
--
-- วิธีใช้: Supabase → โปรเจกต์ FAB HUB (pzspcjqlxoqnbtvlfjsy) → SQL Editor
--          วางทั้งไฟล์นี้แล้วกด Run (รันซ้ำได้ ไม่พัง)
-- ════════════════════════════════════════════════════════════════════

create or replace function public.oe_edit_result(
  p_submitted_at text, p_emp_id text default '', p_exam_id text default '',
  p_patch jsonb default '{}'::jsonb, p_by text default '')
returns jsonb language plpgsql as $$
declare
  v_want  timestamptz := public._oe_ts(p_submitted_at);
  v_id    bigint;
  v_clean jsonb;
begin
  if coalesce(p_submitted_at, '') = '' then return jsonb_build_object('ok', false, 'error', 'no submittedAt'); end if;
  if v_want is null then return jsonb_build_object('ok', false, 'error', 'bad submittedAt'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then return jsonb_build_object('ok', false, 'error', 'bad patch'); end if;
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_clean
    from jsonb_each(p_patch) as t(k, v)
   where k in ('answers', 'correct', 'pct', 'pass', 'result', 'parts',
               'origCorrect', 'origPct', 'origResult', 'origPass',
               'editedBy', 'editedAt', 'editNote', 'editCount');
  if v_clean = '{}'::jsonb then return jsonb_build_object('ok', false, 'error', 'empty patch'); end if;
  select id into v_id from public.oe_results
   where not deleted and public._oe_ts(submitted_at) = v_want
     and (coalesce(p_emp_id, '') = '' or emp_id = btrim(p_emp_id))
     and (coalesce(p_exam_id, '') = '' or exam_id = btrim(p_exam_id))
   order by id desc limit 1;
  if v_id is null then return jsonb_build_object('ok', false, 'error', 'not found'); end if;
  update public.oe_results
     set data = data || v_clean || jsonb_build_object('editedBy', coalesce(p_by, ''), 'editedAt', public._oe_now())
   where id = v_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.oe_edit_result(text, text, text, jsonb, text) from public, anon;
grant execute on function public.oe_edit_result(text, text, text, jsonb, text) to authenticated;
