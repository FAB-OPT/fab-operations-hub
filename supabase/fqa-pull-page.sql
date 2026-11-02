-- ดึงใบ FQA/Visit ทีละหน้า (แก้ปัญหาดึงรวมแล้วไม่ขึ้น)
-- รันในโปรเจกต์ FAB HUB (pzspcjqlxoqnbtvlfjsy) ใน SQL Editor
create or replace function public.fqa_pull_page(
  p_brand text default '',
  p_since timestamptz default null,
  p_after timestamptz default null,
  p_limit int default 300
)
returns jsonb language sql stable as $$
  with page as (
    select r.* from public.fqa_records r
    where (coalesce(p_brand,'') = '' or r.brand = p_brand)
      and (p_since is null or r.server_at > p_since)
      and (p_after is null or r.server_at > p_after)
    order by r.server_at
    limit p_limit
  )
  select jsonb_build_object(
    'ok', true,
    'records', coalesce((select jsonb_agg(p.data order by p.server_at) from page p where not p.deleted), '[]'::jsonb),
    'deleted', coalesce((select jsonb_agg(p.id) from page p where p.deleted), '[]'::jsonb),
    'last', (select max(p.server_at) from page p),
    'count', (select count(*) from page p),
    'serverNow', clock_timestamp()
  );
$$;

revoke all on function public.fqa_pull_page(text, timestamptz, timestamptz, int) from public, anon;
grant execute on function public.fqa_pull_page(text, timestamptz, timestamptz, int) to authenticated;
