-- เก็บ "ตำแหน่งปัจจุบัน" (fromPosition) ของคำขอสอบ — ซานตาเฟ่เลือกตำแหน่งปัจจุบัน แล้วระบบเชื่อมกับตำแหน่งที่สอบ
-- แก้ฟังก์ชัน oe_request ให้เก็บค่าเพิ่ม 1 ช่อง ที่เหลือเหมือนเดิมทุกอย่าง · รันซ้ำได้ ไม่กระทบข้อมูลเดิม
-- ยังไม่รันไฟล์นี้ก็ใช้งานได้ (ระบบเดาตำแหน่งเดิมจากเส้นทางเติบโต) แต่ตำแหน่ง Supervisor จะเดาไม่ได้ว่ามาจากสายบริการหรือครัว
create or replace function public.oe_request(req jsonb)
returns jsonb language plpgsql as $$
declare v_id text; q public.oe_requests%rowtype; v_key text;
begin
  if req is null or public._oe_t(req, 'examId') = '' or public._oe_t(req, 'name') = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid request');
  end if;
  perform pg_advisory_xact_lock(hashtext('oe_requests'));
  -- กันกดขอซ้ำ: คนเดิม ชุดเดิม ส่วนเดิม ที่ยังรออนุมัติหรืออนุมัติแล้วแต่ยังไม่ได้ใช้ → คืนคำขอเดิม
  v_key := public._oe_t(req, 'examId') || '|' || public._oe_t(req, 'name') || '|' || public._oe_t(req, 'empId') || '|' || public._oe_t(req, 'track');
  select * into q from public.oe_requests x
   where not x.deleted and x.status in ('pending', 'approved')
     and public._oe_t(x.data, 'examId') || '|' || public._oe_t(x.data, 'name') || '|' || public._oe_t(x.data, 'empId') || '|' || public._oe_t(x.data, 'track') = v_key
   order by x.created_at limit 1;
  if found then return jsonb_build_object('ok', true, 'duplicate', true, 'id', q.id, 'status', q.status, 'code', q.code); end if;
  v_id := 'req_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || floor(random() * 1e5)::int;
  insert into public.oe_requests (id, code, status, data) values (v_id, '', 'pending', jsonb_build_object(
    'id', v_id, 'createdAt', public._oe_now(),
    'examId', coalesce(req -> 'examId', '""'), 'examTitle', coalesce(req ->> 'examTitle', ''), 'brand', coalesce(req ->> 'brand', ''),
    'branchCode', coalesce(req ->> 'branchCode', ''), 'branchName', coalesce(req ->> 'branchName', ''),
    'name', public._oe_t(req, 'name'), 'empId', public._oe_t(req, 'empId'), 'position', public._oe_t(req, 'position'),
    'requestedBy', public._oe_t(req, 'requestedBy'), 'requestedByName', public._oe_t(req, 'requestedByName'),
    'track', public._oe_t(req, 'track'),
    'fromPosition', public._oe_t(req, 'fromPosition'),
    'status', 'pending', 'code', '', 'approvedAt', '', 'approvedBy', '', 'usedAt', '', 'note', ''));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'pending');
end $$;
