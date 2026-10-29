-- ════════════════════════════════════════════════════════════════════
-- ระบบสอบออนไลน์ · แอดมินแก้ชื่อ-นามสกุล / รหัสพนักงาน / ตำแหน่ง / สาขา ของผู้สอบได้ตลอด
--
-- หน้าผลสอบ → เปิดใบ → "✏️ แก้ข้อมูลผู้สอบ" (แอดมินเท่านั้น)
-- ฟังก์ชันนี้แก้เฉพาะ 4 ช่อง: name · empId · position · branch
--   • เก็บค่าเดิมครั้งแรกไว้ที่ origName / origEmpId ย้อนดูได้ · บันทึกผู้แก้ infoEditedBy / infoEditedAt
--   • คำขอสอบของคนนี้ในชุดเดียวกัน (oe_requests) ตามไปแก้ชื่อ/รหัส/ตำแหน่งให้ด้วย
--     ไม่งั้นจับคู่ "คำขอ ↔ ผลสอบ" ไม่เจอ แล้วหน้าสาขาจะนึกว่ายังไม่ได้สอบ
-- ช่องอื่น (คะแนน · เวลาส่ง · ชุดข้อสอบ ฯลฯ) แก้ผ่านทางนี้ไม่ได้
--
-- วิธีใช้: Supabase → โปรเจกต์ Training Record (cyjfgperenakjeazsfgf) ← ไม่ใช่ FAB HUB → SQL Editor
--          วางทั้งไฟล์นี้แล้วกด Run (รันซ้ำได้ ไม่พัง)
-- ════════════════════════════════════════════════════════════════════

create or replace function public._oe_namekey(v text)
returns text language sql immutable as $$
  select lower(regexp_replace(
           regexp_replace(
             regexp_replace(coalesce(v, ''), '^(นางสาว|นาง|นาย|น\.ส\.|ดร\.|ด\.ช\.|ด\.ญ\.)\s*', ''),
             '^พี่\s*', ''),
           '\s+', '', 'g'))
$$;

create or replace function public.oe_edit_result_info(
  p_submitted_at text, p_emp_id text default '', p_exam_id text default '',
  p_fields jsonb default '{}'::jsonb, p_by text default '')
returns jsonb language plpgsql as $$
declare
  v_want  timestamptz := public._oe_ts(p_submitted_at);
  r       public.oe_results%rowtype;
  v_clean jsonb;
  v_req   jsonb;
  n_req   int := 0;
begin
  if coalesce(p_submitted_at, '') = '' then return jsonb_build_object('ok', false, 'error', 'no submittedAt'); end if;
  if v_want is null then return jsonb_build_object('ok', false, 'error', 'bad submittedAt'); end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then return jsonb_build_object('ok', false, 'error', 'bad fields'); end if;
  select coalesce(jsonb_object_agg(k, to_jsonb(btrim(v #>> '{}'))), '{}'::jsonb) into v_clean
    from jsonb_each(p_fields) as t(k, v)
   where k in ('name', 'empId', 'position', 'branch') and jsonb_typeof(v) = 'string';
  if v_clean = '{}'::jsonb then return jsonb_build_object('ok', false, 'error', 'empty fields'); end if;
  if v_clean ? 'name' and (v_clean ->> 'name') = '' then return jsonb_build_object('ok', false, 'error', 'name is empty'); end if;

  select * into r from public.oe_results
   where not deleted and public._oe_ts(submitted_at) = v_want
     and (coalesce(p_emp_id, '') = '' or emp_id = btrim(p_emp_id))
     and (coalesce(p_exam_id, '') = '' or exam_id = btrim(p_exam_id))
   order by id desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'not found'); end if;

  update public.oe_results
     set name   = coalesce(v_clean ->> 'name', name),
         emp_id = coalesce(v_clean ->> 'empId', emp_id),
         data   = data || v_clean || jsonb_build_object(
                    'infoEditedBy', coalesce(p_by, ''), 'infoEditedAt', public._oe_now(),
                    'origName',  coalesce(data ->> 'origName',  r.name),
                    'origEmpId', coalesce(data ->> 'origEmpId', r.emp_id))
   where id = r.id;

  -- คำขอสอบของคนเดิม ชุดเดิม ตามไปแก้ (ชื่อเทียบแบบตัดคำนำหน้า/ช่องว่างเหมือนที่หน้าเว็บจับคู่)
  v_req := v_clean - 'branch';
  if v_req <> '{}'::jsonb then
    update public.oe_requests q
       set data = q.data || v_req
     where not q.deleted
       and coalesce(q.data ->> 'examId', '') = r.exam_id
       and public._oe_namekey(q.data ->> 'name') = public._oe_namekey(r.name)
       and btrim(coalesce(q.data ->> 'empId', '')) = btrim(r.emp_id);
    get diagnostics n_req = row_count;
  end if;
  return jsonb_build_object('ok', true, 'requests', n_req);
end $$;

revoke all on function public.oe_edit_result_info(text, text, text, jsonb, text) from public, anon;
grant execute on function public.oe_edit_result_info(text, text, text, jsonb, text) to authenticated;
