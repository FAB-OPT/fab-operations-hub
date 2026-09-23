-- ════════════════════════════════════════════════════════════════════
-- ล้างลิงก์รูปของเอกสารที่เกินอายุเก็บ — เบิกเงินประชุมร้าน (mx) · อุปกรณ์ออกบูธ (bt)
--
-- โปรเจกต์: FAB HUB (pzspcjqlxoqnbtvlfjsy)
-- วิธีใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้ ไม่พัง)
--
-- คู่กับการลบไฟล์รูปจริงใน Google Drive (ทำโดยตัวตั้งเวลาใน Apps Script)
-- ล้างเฉพาะช่องรูป · ตัวเอกสาร จำนวนเงิน สถานะ ผู้ส่ง ไม่ถูกแตะ
-- ประทับ photosPurgedAt ไว้ในเอกสาร
-- ════════════════════════════════════════════════════════════════════

create or replace function public.mod_purge_photos(p_app text, p_col text, p_before timestamptz, p_limit int default 500)
returns jsonb language plpgsql as $$
declare n int := 0;
begin
  if public._mod_bad(p_app, p_col, 'x') <> '' then
    raise exception 'mod_purge_photos: app/col ไม่ถูกต้อง (% / %)', p_app, p_col;
  end if;
  with target as (
    select d.app, d.col, d.id from public.hub_docs d
     where d.app = p_app and d.col = p_col and not d.deleted
       and (d.data ->> 'photosPurgedAt') is null
       and jsonb_typeof(d.data -> 'photos') = 'array'
       and jsonb_array_length(d.data -> 'photos') > 0
       and coalesce(nullif(d.data ->> 'submittedAt', ''), nullif(d.data ->> 'createdAt', ''))::timestamptz < p_before
     order by d.created_at
     limit greatest(1, least(coalesce(p_limit, 500), 2000))
  )
  update public.hub_docs d
     set data = jsonb_set(d.data, '{photos}', '[]'::jsonb)
                || jsonb_build_object('photosPurgedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
         updated_at = now(), updated_by = 'ลบตามอายุเก็บ'
    from target t
   where d.app = t.app and d.col = t.col and d.id = t.id;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'app', p_app, 'col', p_col, 'purged', n);
end $$;

revoke all on function public.mod_purge_photos(text, text, timestamptz, int) from public, anon;
grant execute on function public.mod_purge_photos(text, text, timestamptz, int) to authenticated;

-- ดูว่าตอนนี้มีเอกสารที่เข้าเงื่อนไขกี่ใบ (ยังไม่ล้าง แค่นับ)
select col,
       count(*) filter (where coalesce(nullif(data ->> 'submittedAt', ''), nullif(data ->> 'createdAt', ''), '2999-01-01')::timestamptz
                              < now() - interval '180 days') as เกิน180วัน,
       count(*) as ทั้งหมด
  from public.hub_docs where app = 'mx' group by col order by col;
