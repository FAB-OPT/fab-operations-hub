-- ระบบสั่งของครัวกลาง (app = ko) · ใช้ตาราง hub_docs และฟังก์ชัน mod_* เดิมของฮับ
-- โปรเจกต์: FAB HUB (pzspcjqlxoqnbtvlfjsy)
-- วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > Run (รันซ้ำได้ ไม่พัง) · ต้องรัน supabase/hub-docs.sql มาก่อน (รันแล้ว)
--
-- เก็บอะไร:
--   items  = รายการสินค้า {name, cat, bu (หน่วยสาขา), ku (หน่วยครัวกลาง), f (ตัวคูณ 1 bu = f ku), active}
--   orders = ใบสั่งของ  {no, branchName, bzm, orderDate, orderer, note, items[], mail{}}  (เก็บชื่อ/หน่วย/ตัวคูณ ณ วันที่สั่ง)
--   meta   = categories (ลำดับหมวด) · settings (อีเมลครัวกลาง)
-- เฟส 2 (แจ้งเตือน Telegram): ผูกทริกเกอร์ที่ hub_docs เมื่อ app='ko' และ col='orders' เกิดแถวใหม่

create or replace function public._mod_bad(p_app text, p_col text, p_id text)
returns text language sql immutable as $$
  select case
    when p_app not in ('mx', 'bt', 'ko') then 'unknown app'
    when p_app = 'mx' and p_col not in ('config', 'rounds', 'claims', 'payees', 'payeeReq') then 'unknown collection'
    when p_app = 'bt' and p_col not in ('equipment', 'loans', 'meta') then 'unknown collection'
    when p_app = 'ko' and p_col not in ('items', 'orders', 'meta') then 'unknown collection'
    when coalesce(p_id, '') !~ '^[A-Za-z0-9_.:\-]{1,80}$' then 'invalid id'
    else '' end;
$$;

create or replace function public.mod_docs(p_app text)
returns jsonb language sql stable as $$
  select case when p_app not in ('mx', 'bt', 'ko') then jsonb_build_object('ok', false, 'error', 'unknown app')
  else jsonb_build_object(
    'ok', true, 'app', p_app,
    'docs', coalesce((select jsonb_agg(jsonb_build_object('col', d.col, 'id', d.id, 'updatedAt', d.updated_at, 'data', d.data)
                                       order by d.col, d.id)
                        from public.hub_docs d where d.app = p_app and not d.deleted), '[]'::jsonb),
    'now', now(), 'serverNow', clock_timestamp())
  end;
$$;

grant execute on function public.mod_docs(text) to authenticated;
