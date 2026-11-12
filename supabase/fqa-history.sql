-- ════════════════════════════════════════════════════════════════════
-- ประวัติการบันทึก/แก้ไขใบตรวจ FQA / FSQ / Visit  —  modules/fqa-visit.html
--
-- โปรเจกต์: FAB HUB (pzspcjqlxoqnbtvlfjsy)
-- วิธีใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้ ไม่พัง)
-- ต้องรัน supabase/fqa-records.sql ไปก่อนแล้ว
--
-- ทำอะไร: ทุกครั้งที่ตาราง fqa_records ถูกเขียน (สร้าง / แก้ / ลบ / กู้คืน / บันทึกซ้ำ)
--   ทริกเกอร์จะจดลง fqa_history อัตโนมัติ ไม่ต้องแก้ตัวเขียนเดิม
--   action:  create  = สร้างใบใหม่
--            edit    = แก้แล้วเนื้อหาเปลี่ยนจริง (changed = ชื่อช่องที่เปลี่ยน · prev = ของเดิมก่อนแก้)
--            resave  = บันทึกซ้ำโดยเนื้อหาไม่เปลี่ยนเลย (นี่คือตัวบอกว่า "บันทึกซ้ำ")
--            delete / restore = ลบ / ยกเลิกการลบ
--   ประวัติเริ่มจดตั้งแต่รันไฟล์นี้ · ใบเดิมก่อนหน้านั้นมีแค่เวลาสร้างกับเวลาล่าสุด
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.fqa_history (
  id          bigserial primary key,
  rec_id      text not null,
  at          timestamptz not null default now(),
  action      text not null,
  type        text not null default '',
  branch      text not null default '',
  date        text not null default '',
  updated_at  text not null default '',      -- updatedAt ของใบ (เวลาตามเครื่องที่บันทึก)
  saved_by    text not null default '',      -- ชื่อคนที่กดบันทึก (data.savedBy)
  device      text not null default '',      -- เครื่องที่บันทึก (data.dev)
  changed     text[] not null default '{}',
  size        int  not null default 0,
  prev        jsonb
);
create index if not exists fqa_history_rec on public.fqa_history (rec_id, at desc);

-- ตารางนี้เขียนได้จากทริกเกอร์เท่านั้น · อ่านผ่านฟังก์ชัน fqa_history()
alter table public.fqa_history enable row level security;
revoke all on public.fqa_history from anon, authenticated;

create or replace function public.fqa_history_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_act text; v_changed text[] := '{}'; v_prev jsonb := null;
  v_skip text[] := array['updatedAt','savedBy','dev'];
begin
  if tg_op = 'INSERT' then
    v_act := case when new.deleted then 'delete' else 'create' end;
  else
    if not old.deleted and new.deleted then
      v_act := 'delete'; v_prev := old.data;
    elsif old.deleted and not new.deleted then
      v_act := 'restore';
    else
      select coalesce(array_agg(k order by k), '{}') into v_changed
        from (select k from (select jsonb_object_keys(coalesce(new.data,'{}'::jsonb)) k
                              union select jsonb_object_keys(coalesce(old.data,'{}'::jsonb))) u
               where not (k = any(v_skip))
                 and (new.data -> k) is distinct from (old.data -> k)) c;
      if coalesce(array_length(v_changed,1),0) = 0 then v_act := 'resave';
      else v_act := 'edit'; v_prev := old.data; end if;
    end if;
  end if;
  insert into public.fqa_history (rec_id, action, type, branch, date, updated_at, saved_by, device, changed, size, prev)
  values (new.id, v_act, new.type, new.branch, new.date, new.updated_at,
          coalesce(new.data->>'savedBy',''), coalesce(new.data->>'dev',''), v_changed,
          length(coalesce(new.data::text,'')), v_prev);
  return new;
end $$;

drop trigger if exists fqa_records_history on public.fqa_records;
create trigger fqa_records_history after insert or update on public.fqa_records
  for each row execute function public.fqa_history_log();

-- ── อ่านประวัติของใบเดียว (ใหม่สุดก่อน) ──
create or replace function public.fqa_history(p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', true,
    'cur', (select jsonb_build_object('created_at', r.created_at, 'server_at', r.server_at,
                                      'updated_at', r.updated_at, 'deleted', r.deleted)
              from public.fqa_records r where r.id = p_id),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
              'at', h.at, 'action', h.action, 'updated_at', h.updated_at, 'saved_by', h.saved_by,
              'device', h.device, 'changed', h.changed, 'size', h.size) order by h.at desc, h.id desc)
            from public.fqa_history h where h.rec_id = p_id), '[]'::jsonb));
$$;

revoke all on function public.fqa_history(text) from public, anon;
grant execute on function public.fqa_history(text) to authenticated;
