-- ════════════════════════════════════════════════════════════════════
-- ระบบสอบออนไลน์ · (1) แอดมินแก้ผลสอบรายข้อ (ตรวจใหม่ / เฉลยผิด)
--                 (2) เก็บร่างชุดเอกสาร (ใบปรับสภาพ ฯลฯ) ไว้บนระบบกลาง เปิดต่อได้ทุกเครื่อง
--
-- หน้าผลสอบ → เปิดใบ → "✏️ แก้ผลรายข้อ" → กดถูก/ผิดรายข้อ → ใส่เหตุผล → บันทึก
-- ฟังก์ชันนี้รับ "ส่วนที่แก้" แล้วผสานลงผลสอบใบเดิม (data) — เฉพาะช่องที่อนุญาตด้านล่างเท่านั้น
--   answers · correct · pct · pass · result · parts
--   origCorrect · origPct · origResult · origPass (ค่าก่อนแก้ครั้งแรก เก็บไว้ย้อนดู)
--   editedBy · editedAt · editNote · editCount
-- ช่องอื่น (ชื่อ · รหัส · เวลาส่ง · ชุดข้อสอบ ฯลฯ) แก้ผ่านทางนี้ไม่ได้
--
-- วิธีใช้: Supabase → โปรเจกต์ Training Record (cyjfgperenakjeazsfgf) ← ไม่ใช่ FAB HUB → SQL Editor
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

-- ════════ (2) ร่างชุดเอกสารประกอบผลสอบ ════════
-- key = รหัสร่างที่หน้าเว็บสร้าง (ชุดข้อสอบ|ชื่อ|รหัสพนักงาน|เวลาส่ง) · data = ค่าที่กรอกในใบปรับสภาพ/ใบประเมิน + ใบที่ติ๊กไว้
create table if not exists public.oe_doc_drafts (
  key        text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);
alter table public.oe_doc_drafts enable row level security;
drop policy if exists oe_doc_drafts_auth on public.oe_doc_drafts;
create policy oe_doc_drafts_auth on public.oe_doc_drafts for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.oe_doc_drafts to authenticated;
revoke all on public.oe_doc_drafts from anon;

create or replace function public.oe_doc_draft_get(p_key text)
returns jsonb language sql stable as $$
  select coalesce(
    (select jsonb_build_object('ok', true, 'draft', d.data, 'updatedAt', d.updated_at, 'by', d.updated_by)
       from public.oe_doc_drafts d where d.key = p_key),
    jsonb_build_object('ok', true, 'draft', null));
$$;

create or replace function public.oe_doc_draft_save(p_key text, p_draft jsonb, p_by text default '')
returns jsonb language plpgsql as $$
begin
  if coalesce(p_key, '') = '' then return jsonb_build_object('ok', false, 'error', 'no key'); end if;
  -- ว่าง = ล้างร่าง
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' or p_draft = '{}'::jsonb then
    delete from public.oe_doc_drafts where key = p_key;
    return jsonb_build_object('ok', true, 'cleared', true);
  end if;
  insert into public.oe_doc_drafts (key, data, updated_by) values (p_key, p_draft, coalesce(p_by, ''))
  on conflict (key) do update set data = excluded.data, updated_at = now(), updated_by = excluded.updated_by;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.oe_doc_draft_get(text) from public, anon;
revoke all on function public.oe_doc_draft_save(text, jsonb, text) from public, anon;
grant execute on function public.oe_doc_draft_get(text) to authenticated;
grant execute on function public.oe_doc_draft_save(text, jsonb, text) to authenticated;
