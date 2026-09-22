-- ════════════════════════════════════════════════════════════════════
-- ระบบสอบออนไลน์  —  modules/online-exam.html
--
-- โปรเจกต์: Training Record (cyjfgperenakjeazsfgf)  ← ไม่ใช่ FAB HUB
-- วิธีใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้ ไม่พัง)
--
-- ย้ายมาจากชีต Exams / ExamResults / ExamRequests (Apps Script) — 22 ก.ย. 2569
--   ฟังก์ชันทุกตัวคืนรูปแบบเดียวกับ Code.gs เป๊ะ หน้าเว็บจึงไม่ต้องแก้ส่วนอื่น
--   กติกาเดิมอยู่ครบ: กันส่งผลซ้ำ · กันขอสอบซ้ำ · รหัสเข้าสอบ 6 ตัว ใช้ได้ครั้งเดียว · อนุมัติซ้ำได้รหัสเดิม
--   ลบ = ติดธง deleted ไว้ กู้คืนได้
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.oe_exams (
  id         text primary key,
  data       jsonb not null,                   -- ชุดข้อสอบทั้งก้อน (ตั้งค่า + คำถาม)
  deleted    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.oe_results (
  id           bigserial primary key,
  submitted_at text not null default '',
  exam_id      text not null default '',
  emp_id       text not null default '',
  name         text not null default '',
  data         jsonb not null,                 -- ผลสอบทั้งก้อน (รวม answers · parts)
  deleted      boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists oe_results_exam_idx on public.oe_results (exam_id);

create table if not exists public.oe_requests (
  id         text primary key,
  code       text not null default '',
  status     text not null default 'pending',  -- pending | approved | rejected | used
  data       jsonb not null,                   -- คำขอทั้งก้อน (ช่องเดียวกับชีต ExamRequests)
  deleted    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists oe_requests_code_idx on public.oe_requests (upper(code));

-- ── ต้องล็อกอินก่อนถึงจะแตะข้อมูลได้ ──
alter table public.oe_exams    enable row level security;
alter table public.oe_results  enable row level security;
alter table public.oe_requests enable row level security;
drop policy if exists oe_exams_auth    on public.oe_exams;
drop policy if exists oe_results_auth  on public.oe_results;
drop policy if exists oe_requests_auth on public.oe_requests;
create policy oe_exams_auth    on public.oe_exams    for all to authenticated using (true) with check (true);
create policy oe_results_auth  on public.oe_results  for all to authenticated using (true) with check (true);
create policy oe_requests_auth on public.oe_requests for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.oe_exams, public.oe_results, public.oe_requests to authenticated;
grant usage, select on sequence public.oe_results_id_seq to authenticated;
revoke all on public.oe_exams, public.oe_results, public.oe_requests from anon;

-- ── ตัวช่วย ──
create or replace function public._oe_ts(v text)
returns timestamptz language plpgsql immutable as $$
begin return v::timestamptz; exception when others then return null; end $$;

create or replace function public._oe_now()
returns text language sql stable as $$ select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

create or replace function public._oe_t(j jsonb, k text)
returns text language sql immutable as $$ select btrim(coalesce(j ->> k, '')) $$;

-- ════════ ชุดข้อสอบ ════════
create or replace function public.oe_exams()
returns jsonb language sql stable as $$
  select jsonb_build_object('ok', true, 'exams',
    coalesce((select jsonb_agg(e.data order by e.created_at) from public.oe_exams e where not e.deleted), '[]'::jsonb));
$$;

create or replace function public.oe_save_exam(exam jsonb)
returns jsonb language plpgsql as $$
declare v_id text; v_upd boolean;
begin
  if exam is null or public._oe_t(exam, 'title') = '' then return jsonb_build_object('ok', false, 'error', 'invalid exam'); end if;
  v_id := public._oe_t(exam, 'id');
  if v_id = '' then v_id := 'exam_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || floor(random() * 1e5)::int; end if;
  exam := exam || jsonb_build_object('id', v_id, 'updatedAt', public._oe_now());
  select exists(select 1 from public.oe_exams where id = v_id and not deleted) into v_upd;
  insert into public.oe_exams (id, data, deleted, updated_at) values (v_id, exam, false, now())
  on conflict (id) do update set data = excluded.data, deleted = false, updated_at = now();
  return jsonb_build_object('ok', true, 'id', v_id, 'updated', v_upd);
end $$;

create or replace function public.oe_delete_exam(p_id text)
returns jsonb language plpgsql as $$
begin
  if coalesce(p_id, '') = '' then return jsonb_build_object('ok', false, 'error', 'no id'); end if;
  update public.oe_exams set deleted = true, updated_at = now() where id = p_id and not deleted;
  if not found then return jsonb_build_object('ok', false, 'error', 'not found'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ════════ รหัสเข้าสอบ ════════
create or replace function public.oe_use_code(p_code text)
returns jsonb language plpgsql as $$
declare v_want text := upper(btrim(coalesce(p_code, ''))); r public.oe_requests%rowtype;
begin
  if v_want = '' then return jsonb_build_object('ok', false, 'error', 'no code'); end if;
  perform pg_advisory_xact_lock(hashtext('oe_requests'));
  select * into r from public.oe_requests where upper(code) = v_want and not deleted order by created_at limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'not found'); end if;
  if r.status = 'used' then return jsonb_build_object('ok', true, 'already', true); end if;
  update public.oe_requests set status = 'used',
    data = data || jsonb_build_object('status', 'used', 'usedAt', public._oe_now()) where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.oe_verify_code(p_code text, p_exam_id text default '')
returns jsonb language plpgsql as $$
declare v_want text := upper(btrim(coalesce(p_code, ''))); r public.oe_requests%rowtype;
begin
  if v_want = '' then return jsonb_build_object('ok', false, 'error', 'no code'); end if;
  select * into r from public.oe_requests where upper(code) = v_want and not deleted order by created_at limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบรหัสนี้'); end if;
  if r.status = 'used' then return jsonb_build_object('ok', false, 'error', 'รหัสนี้ถูกใช้ไปแล้ว'); end if;
  if r.status <> 'approved' then return jsonb_build_object('ok', false, 'error', 'รหัสนี้ยังไม่ได้รับอนุมัติ'); end if;
  if coalesce(p_exam_id, '') <> '' and public._oe_t(r.data, 'examId') <> p_exam_id then
    return jsonb_build_object('ok', false, 'error', 'รหัสนี้ไม่ใช่ของชุดข้อสอบนี้');
  end if;
  return jsonb_build_object('ok', true, 'request', jsonb_build_object(
    'id', r.id, 'examId', r.data -> 'examId', 'name', r.data -> 'name', 'empId', r.data -> 'empId',
    'position', coalesce(r.data ->> 'position', ''), 'branchName', r.data -> 'branchName',
    'branchCode', r.data -> 'branchCode', 'track', coalesce(r.data ->> 'track', '')));
end $$;

-- ════════ ผลสอบ ════════
create or replace function public.oe_results()
returns jsonb language sql stable as $$
  select jsonb_build_object('ok', true, 'results',
    coalesce((select jsonb_agg(r.data order by r.id) from public.oe_results r where not r.deleted), '[]'::jsonb));
$$;

create or replace function public.oe_submit_result(r jsonb)
returns jsonb language plpgsql as $$
declare v_sub text;
begin
  if r is null or public._oe_t(r, 'name') = '' then return jsonb_build_object('ok', false, 'error', 'invalid result'); end if;
  -- ปิดรหัสเข้าสอบทันทีที่ผลถูกบันทึก (ผู้ใช้อาจปิดจอทิ้งหลังส่ง)
  if public._oe_t(r, 'accessCode') <> '' then perform public.oe_use_code(r ->> 'accessCode'); end if;
  perform pg_advisory_xact_lock(hashtext('oe_results'));
  v_sub := public._oe_t(r, 'submittedAt');
  if v_sub = '' then v_sub := public._oe_now(); r := r || jsonb_build_object('submittedAt', v_sub); end if;
  -- กันบันทึกซ้ำ: เวลาส่ง + ชุด + รหัส + ชื่อ ตรงกัน = ผลเดียวกันถูกยิงซ้ำ
  if exists (select 1 from public.oe_results x where not x.deleted and x.submitted_at = v_sub
               and x.exam_id = public._oe_t(r, 'examId') and x.emp_id = public._oe_t(r, 'empId')
               and x.name = public._oe_t(r, 'name')) then
    return jsonb_build_object('ok', true, 'saved', 0, 'duplicate', true);
  end if;
  insert into public.oe_results (submitted_at, exam_id, emp_id, name, data)
  values (v_sub, public._oe_t(r, 'examId'), public._oe_t(r, 'empId'), public._oe_t(r, 'name'), r - 'accessCode');
  return jsonb_build_object('ok', true, 'saved', 1);
end $$;

create or replace function public.oe_delete_result(p_submitted_at text, p_emp_id text default '', p_exam_id text default '')
returns jsonb language plpgsql as $$
declare v_want timestamptz := public._oe_ts(p_submitted_at); v_id bigint;
begin
  if coalesce(p_submitted_at, '') = '' then return jsonb_build_object('ok', false, 'error', 'no submittedAt'); end if;
  if v_want is null then return jsonb_build_object('ok', false, 'error', 'bad submittedAt'); end if;
  select id into v_id from public.oe_results
   where not deleted and public._oe_ts(submitted_at) = v_want
     and (coalesce(p_emp_id, '') = '' or emp_id = btrim(p_emp_id))
     and (coalesce(p_exam_id, '') = '' or exam_id = btrim(p_exam_id))
   order by id desc limit 1;
  if v_id is null then return jsonb_build_object('ok', false, 'error', 'not found'); end if;
  update public.oe_results set deleted = true where id = v_id;
  return jsonb_build_object('ok', true);
end $$;

-- ════════ คำขอสอบ ════════
-- p_branch = ชื่อหรือรหัสสาขา (ฝั่งสาขา) · p_scope = 'all' (ฝั่งแอดมิน)
create or replace function public.oe_requests(p_branch text default '', p_scope text default '')
returns jsonb language sql stable as $$
  select jsonb_build_object('ok', true, 'requests', coalesce((
    select jsonb_agg(q.data || jsonb_build_object('status', q.status, 'code', q.code) order by q.created_at)
      from public.oe_requests q
     where not q.deleted
       and (coalesce(p_scope, '') = 'all'
            or (btrim(coalesce(p_branch, '')) <> ''
                and (public._oe_t(q.data, 'branchName') = btrim(p_branch) or public._oe_t(q.data, 'branchCode') = btrim(p_branch))))
  ), '[]'::jsonb));
$$;

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
    'status', 'pending', 'code', '', 'approvedAt', '', 'approvedBy', '', 'usedAt', '', 'note', ''));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'pending');
end $$;

-- อนุมัติ = สุ่มรหัส 6 ตัว (ตัด 0/O 1/I/L) · เคยอนุมัติแล้วคืนรหัสเดิม
create or replace function public.oe_decide(p_id text, p_decision text, p_by text default '', p_note text default '')
returns jsonb language plpgsql as $$
declare q public.oe_requests%rowtype; v_st text; v_code text := ''; ab text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; t int; i int;
begin
  if coalesce(p_id, '') = '' then return jsonb_build_object('ok', false, 'error', 'no id'); end if;
  perform pg_advisory_xact_lock(hashtext('oe_requests'));
  select * into q from public.oe_requests where id = p_id and not deleted;
  if not found then return jsonb_build_object('ok', false, 'error', 'not found'); end if;
  if q.status = 'used' then return jsonb_build_object('ok', false, 'error', 'ทำข้อสอบไปแล้ว'); end if;
  v_st := case when p_decision = 'reject' then 'rejected' else 'approved' end;
  if v_st = 'approved' then
    v_code := q.code;
    if v_code = '' then
      for t in 1..200 loop
        v_code := '';
        for i in 1..6 loop v_code := v_code || substr(ab, 1 + floor(random() * length(ab))::int, 1); end loop;
        exit when not exists (select 1 from public.oe_requests where upper(code) = v_code);
      end loop;
    end if;
  end if;
  update public.oe_requests set status = v_st, code = v_code,
    data = data || jsonb_build_object('status', v_st, 'code', v_code, 'approvedAt', public._oe_now(),
                                      'approvedBy', coalesce(p_by, ''),
                                      'note', coalesce(nullif(p_note, ''), data ->> 'note', ''))
   where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'status', v_st, 'code', v_code);
end $$;

create or replace function public.oe_delete_request(p_id text)
returns jsonb language plpgsql as $$
begin
  if coalesce(p_id, '') = '' then return jsonb_build_object('ok', false, 'error', 'no id'); end if;
  update public.oe_requests set deleted = true where id = p_id and not deleted;
  if not found then return jsonb_build_object('ok', false, 'error', 'not found'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ════════ ย้ายของเดิมจากชีต (ใช้ครั้งเดียวตอนย้าย · คงสถานะ/รหัส/เวลาเดิมไว้ครบ) ════════
create or replace function public.oe_import(p_exams jsonb, p_results jsonb, p_requests jsonb)
returns jsonb language plpgsql as $$
declare e jsonb; r jsonb; n1 int := 0; n2 int := 0; n3 int := 0;
begin
  for e in select * from jsonb_array_elements(coalesce(p_exams, '[]')) loop
    insert into public.oe_exams (id, data) values (e ->> 'id', e) on conflict (id) do nothing;
    if found then n1 := n1 + 1; end if;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]')) loop
    if not exists (select 1 from public.oe_results x where x.submitted_at = public._oe_t(r, 'submittedAt')
                     and x.exam_id = public._oe_t(r, 'examId') and x.emp_id = public._oe_t(r, 'empId') and x.name = public._oe_t(r, 'name')) then
      insert into public.oe_results (submitted_at, exam_id, emp_id, name, data)
      values (public._oe_t(r, 'submittedAt'), public._oe_t(r, 'examId'), public._oe_t(r, 'empId'), public._oe_t(r, 'name'), r - 'answersJson' - 'partsJson');
      n2 := n2 + 1;
    end if;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_requests, '[]')) loop
    insert into public.oe_requests (id, code, status, data, created_at)
    values (r ->> 'id', coalesce(r ->> 'code', ''), coalesce(nullif(r ->> 'status', ''), 'pending'), r,
            coalesce(public._oe_ts(r ->> 'createdAt'), now()))
    on conflict (id) do nothing;
    if found then n3 := n3 + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'exams', n1, 'results', n2, 'requests', n3);
end $$;

do $$
declare f text;
begin
  foreach f in array array['oe_exams()', 'oe_save_exam(jsonb)', 'oe_delete_exam(text)', 'oe_use_code(text)',
    'oe_verify_code(text,text)', 'oe_results()', 'oe_submit_result(jsonb)', 'oe_delete_result(text,text,text)',
    'oe_requests(text,text)', 'oe_request(jsonb)', 'oe_decide(text,text,text,text)', 'oe_delete_request(text)',
    'oe_import(jsonb,jsonb,jsonb)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
