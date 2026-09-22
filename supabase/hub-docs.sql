-- ════════════════════════════════════════════════════════════════════
-- โมดูลเล็กของฮับ: เบิกเงินประชุมร้าน (mx) · อุปกรณ์ออกบูธ (bt)
-- ใช้ร่วมผ่าน modules/hub-docstore.js
--
-- โปรเจกต์: FAB HUB (pzspcjqlxoqnbtvlfjsy)
-- วิธีใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้ ไม่พัง)
--
-- ย้ายมาจากชีต MeetExpense / BoothEquipment (Apps Script) — 22 ก.ย. 2569
--   กติกาเดิมอยู่ครบ:
--   · save   = ทับทั้งก้อน · update = รวมเฉพาะฟิลด์ที่ส่งมาเข้ากับของเดิม (ทำใต้ล็อกแถว)
--   · expect = เงื่อนไขก่อนเขียน เช่น {"status":"pending"} ถ้าอีกเครื่องทำไปก่อน → 'conflict'
--             กันอนุมัติบิลซ้ำ / รับคืนของซ้ำ
--   รูปยังอยู่ Google Drive (อัปผ่าน Apps Script) ในเอกสารเก็บแค่ลิงก์
--   ลบ = ติดธง deleted ไว้ กู้คืนได้
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.hub_docs (
  app         text not null,                 -- mx | bt
  col         text not null,
  id          text not null,
  data        jsonb not null default '{}'::jsonb,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default '',
  created_at  timestamptz not null default now(),
  primary key (app, col, id)
);

alter table public.hub_docs enable row level security;
drop policy if exists hub_docs_all_auth on public.hub_docs;
create policy hub_docs_all_auth on public.hub_docs
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.hub_docs to authenticated;
revoke all on public.hub_docs from anon;

-- ── ตรวจ app / col / id (ชุดเดียวกับ Code.gs) ──
create or replace function public._mod_bad(p_app text, p_col text, p_id text)
returns text language sql immutable as $$
  select case
    when p_app not in ('mx', 'bt') then 'unknown app'
    when p_app = 'mx' and p_col not in ('config', 'rounds', 'claims', 'payees', 'payeeReq') then 'unknown collection'
    when p_app = 'bt' and p_col not in ('equipment', 'loans', 'meta') then 'unknown collection'
    when coalesce(p_id, '') !~ '^[A-Za-z0-9_.:\-]{1,80}$' then 'invalid id'
    else '' end;
$$;

-- ── expect: ทุกฟิลด์ใน expect ต้องเท่ากับของเดิม · ไม่มีของเดิม = ไม่ผ่าน ──
create or replace function public._mod_expect_ok(cur jsonb, expect jsonb)
returns boolean language sql immutable as $$
  select case
    when expect is null or jsonb_typeof(expect) <> 'object' or expect = '{}'::jsonb then true
    when cur is null then false
    else not exists (select 1 from jsonb_each(expect) e where (cur -> e.key) is distinct from e.value)
  end;
$$;

-- ── อ่านทั้งระบบ ──
create or replace function public.mod_docs(p_app text)
returns jsonb language sql stable as $$
  select case when p_app not in ('mx', 'bt') then jsonb_build_object('ok', false, 'error', 'unknown app')
  else jsonb_build_object(
    'ok', true, 'app', p_app,
    'docs', coalesce((select jsonb_agg(jsonb_build_object('col', d.col, 'id', d.id, 'updatedAt', d.updated_at, 'data', d.data)
                                       order by d.col, d.id)
                        from public.hub_docs d where d.app = p_app and not d.deleted), '[]'::jsonb),
    'now', now(), 'serverNow', clock_timestamp())
  end;
$$;

-- ── บันทึก / รวมฟิลด์ ──
create or replace function public.mod_save(p_app text, p_col text, p_id text, p_data jsonb,
                                           p_merge boolean default false, p_by text default '', p_expect jsonb default null)
returns jsonb language plpgsql as $$
declare
  v_bad text := public._mod_bad(p_app, p_col, p_id);
  v_cur jsonb;
  v_next jsonb;
  v_now timestamptz := now();
begin
  if v_bad <> '' then return jsonb_build_object('ok', false, 'error', v_bad); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return jsonb_build_object('ok', false, 'error', 'invalid data'); end if;
  select case when deleted then null else data end into v_cur
    from public.hub_docs where app = p_app and col = p_col and id = p_id for update;
  if not public._mod_expect_ok(v_cur, p_expect) then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'current', v_cur);
  end if;
  if p_merge then
    if v_cur is null then return jsonb_build_object('ok', false, 'error', 'not found'); end if;
    v_next := v_cur || p_data;
  else
    v_next := p_data;
  end if;
  insert into public.hub_docs (app, col, id, data, deleted, updated_at, updated_by)
  values (p_app, p_col, p_id, v_next, false, v_now, left(coalesce(p_by, ''), 80))
  on conflict (app, col, id) do update set data = excluded.data, deleted = false,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return jsonb_build_object('ok', true, 'doc', jsonb_build_object('col', p_col, 'id', p_id, 'updatedAt', v_now, 'data', v_next));
end $$;

-- ── ลบ (ติดธง) ──
create or replace function public.mod_delete(p_app text, p_col text, p_id text, p_expect jsonb default null, p_by text default '')
returns jsonb language plpgsql as $$
declare
  v_bad text := public._mod_bad(p_app, p_col, p_id);
  v_cur jsonb;
begin
  if v_bad <> '' then return jsonb_build_object('ok', false, 'error', v_bad); end if;
  select case when deleted then null else data end into v_cur
    from public.hub_docs where app = p_app and col = p_col and id = p_id for update;
  if not public._mod_expect_ok(v_cur, p_expect) then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'current', v_cur);
  end if;
  update public.hub_docs set deleted = true, updated_at = now(), updated_by = left(coalesce(p_by, ''), 80)
   where app = p_app and col = p_col and id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.mod_docs(text)                                          from public, anon;
revoke all on function public.mod_save(text, text, text, jsonb, boolean, text, jsonb)  from public, anon;
revoke all on function public.mod_delete(text, text, text, jsonb, text)                from public, anon;
grant execute on function public.mod_docs(text)                                         to authenticated;
grant execute on function public.mod_save(text, text, text, jsonb, boolean, text, jsonb) to authenticated;
grant execute on function public.mod_delete(text, text, text, jsonb, text)               to authenticated;
