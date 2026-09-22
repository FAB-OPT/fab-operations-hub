-- ════════════════════════════════════════════════════════════════════
-- ระบบ FQA / FSQ / Visit สาขา  —  modules/fqa-visit.html
--
-- โปรเจกต์: FAB HUB (pzspcjqlxoqnbtvlfjsy)
-- วิธีใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้ ไม่พัง)
--
-- ย้ายตัวใบตรวจมาจากชีต FqaRecords (Apps Script) — 22 ก.ย. 2569
--   ชีตช้าและค้างได้เป็นนาที (ต้องเปิดทั้งไฟล์) ใบจึงค้างในเครื่องคนตรวจ
--   ส่วนรูปยังอยู่ Google Drive เหมือนเดิม (อัปผ่าน Apps Script) ในใบเก็บแค่ลิงก์
--   ช่วงเปลี่ยนผ่านหน้าเว็บยังเขียนลงชีตคู่กันไปด้วย ชีตจึงยังเป็นที่สำรอง
--
-- 1 ตาราง: fqa_records = ใบตรวจ 1 ใบ (ทั้งก้อนอยู่ใน data)
--   ลบ = ติดธง deleted ไว้ ไม่ลบแถวทิ้ง → เครื่องอื่นรู้ว่าต้องลบตาม และกู้คืนได้
--   server_at = เวลาของเซิร์ฟเวอร์ตอนเขียน ใช้ดึงเฉพาะที่เปลี่ยน
--               (ไม่ใช้เวลาของเครื่องคนตรวจ เพราะนาฬิกาแต่ละเครื่องไม่ตรงกัน)
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.fqa_records (
  id          text primary key,
  brand       text not null default '',                -- jaedaeng | santafe
  type        text not null default '',                -- FQA | FSQ | VISIT | PLAN
  date        text not null default '',
  branch      text not null default '',
  updated_at  text not null default '',                -- updatedAt ของใบ (ISO จากเครื่องที่บันทึก)
  data        jsonb not null default '{}'::jsonb,      -- ใบทั้งก้อน
  deleted     boolean not null default false,
  server_at   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists fqa_records_brand_at on public.fqa_records (brand, server_at);
create index if not exists fqa_records_at       on public.fqa_records (server_at);

-- ── ต้องล็อกอินก่อนถึงจะแตะข้อมูลได้ ──
alter table public.fqa_records enable row level security;
drop policy if exists fqa_records_all_auth on public.fqa_records;
create policy fqa_records_all_auth on public.fqa_records
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.fqa_records to authenticated;
revoke all on public.fqa_records from anon;

-- ── บันทึก 1 ใบ ──
-- ใบบนคลาวด์ใหม่กว่าที่ส่งมา = ไม่ทับ (คืน stale) เครื่องที่ส่งมาจะดึงฉบับใหม่ลงไปเอง
-- บันทึก id ที่เคยถูกลบ = ยกเลิกการลบ (เหมือนชีตเดิม)
create or replace function public.fqa_save(rec jsonb)
returns jsonb language plpgsql as $$
declare
  v_id  text := coalesce(rec->>'id', '');
  v_up  text := coalesce(rec->>'updatedAt', '');
  v_cur public.fqa_records%rowtype;
begin
  if v_id = '' then return jsonb_build_object('ok', false, 'error', 'invalid record'); end if;
  select * into v_cur from public.fqa_records where id = v_id;
  if found and not v_cur.deleted and v_up <> '' and v_cur.updated_at > v_up then
    return jsonb_build_object('ok', true, 'id', v_id, 'stale', true);
  end if;
  insert into public.fqa_records (id, brand, type, date, branch, updated_at, data, deleted, server_at)
  values (v_id, coalesce(rec->>'brand',''), coalesce(rec->>'type',''), coalesce(rec->>'date',''),
          coalesce(rec->>'branch',''), v_up, rec, false, now())
  on conflict (id) do update set
    brand = excluded.brand, type = excluded.type, date = excluded.date, branch = excluded.branch,
    updated_at = excluded.updated_at, data = excluded.data, deleted = false, server_at = now();
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ── ลบ 1 ใบ (ติดธง ไม่ลบแถว) ──
create or replace function public.fqa_delete(p_id text, p_brand text default '')
returns jsonb language plpgsql as $$
begin
  if coalesce(p_id, '') = '' then return jsonb_build_object('ok', false, 'error', 'no id'); end if;
  insert into public.fqa_records (id, brand, deleted, server_at)
  values (p_id, coalesce(p_brand, ''), true, now())
  on conflict (id) do update set deleted = true, server_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- ── ดึงรายการ ── p_since ว่าง = ทั้งหมด · มีค่า = เฉพาะที่เปลี่ยนหลังเวลานั้น
-- รูปแบบคำตอบเหมือนหลังบ้านชีตเดิม หน้าเว็บจึงใช้ตรรกะรวมข้อมูลชุดเดิมได้
create or replace function public.fqa_pull(p_brand text default '', p_since timestamptz default null)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'ok', true,
    'records', coalesce((select jsonb_agg(r.data order by r.server_at) from public.fqa_records r
                         where not r.deleted and (coalesce(p_brand,'') = '' or r.brand = p_brand)
                           and (p_since is null or r.server_at > p_since)), '[]'::jsonb),
    'deleted', coalesce((select jsonb_agg(r.id) from public.fqa_records r
                         where r.deleted and (p_since is null or r.server_at > p_since)), '[]'::jsonb),
    'now', now(),
    'serverNow', clock_timestamp()
  );
$$;

-- ── ใบเดียว (หน้าลิงก์แชร์) ──
create or replace function public.fqa_one(p_id text)
returns jsonb language sql stable as $$
  select coalesce(
    (select jsonb_build_object('ok', true, 'record', case when r.deleted then null else r.data end, 'deleted', r.deleted)
       from public.fqa_records r where r.id = p_id),
    jsonb_build_object('ok', true, 'record', null, 'deleted', false, 'missing', true));
$$;

revoke all on function public.fqa_save(jsonb)                from public, anon;
revoke all on function public.fqa_delete(text, text)         from public, anon;
revoke all on function public.fqa_pull(text, timestamptz)    from public, anon;
revoke all on function public.fqa_one(text)                  from public, anon;
grant execute on function public.fqa_save(jsonb)             to authenticated;
grant execute on function public.fqa_delete(text, text)      to authenticated;
grant execute on function public.fqa_pull(text, timestamptz) to authenticated;
grant execute on function public.fqa_one(text)               to authenticated;
